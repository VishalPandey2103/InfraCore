const amqp = require("amqplib");
const {
    RABBITMQ_URL,
    RABBITMQ_EXCHANGE,
    RABBITMQ_QUEUE,
    RABBITMQ_RETRY_EXCHANGE,
    RABBITMQ_RETRY_QUEUE,
    RABBITMQ_PARKING_QUEUE,
} = require("./envConfig");
const EVENTS = require("../events/eventNames");

let channel = null;

// -----------------------------------------------------------------------------
// Topology (before you touch code, understand the picture):
//
//   PRODUCER (booking-service)
//        │  publish routing key: BOOKING_CREATED / BOOKING_APPROVED / ...
//        ▼
//   Exchange "infracore.events" (topic)
//        │  bindings: one per event name
//        ▼
//   Queue "notification.bookings" ────────────────► consumer processes
//        │                                                 │
//        │ nack(false)  = handler threw                    │ ack() = success, done
//        ▼                                                 │
//   Dead-letter exchange (implicit via queue args)         │
//        │                                                 │
//        ▼                                                 │
//   Retry exchange "infracore.retry"                       │
//        │                                                 │
//        ▼                                                 │
//   Queue "notification.bookings.retry"                    │
//     - has TTL (via message header per-message)           │
//     - on TTL expiry, dead-letters BACK to main exchange  │
//       with the ORIGINAL routing key, so the message      │
//       ends up back in "notification.bookings" for retry  │
//        │                                                 │
//        ▼                                                 │
//   (loops until MAX_RETRIES exceeded, then consumer       │
//    hand-publishes to parking queue for manual review)    │
//
// Why a separate retry queue instead of RabbitMQ's built-in requeue?
//   - requeue re-delivers IMMEDIATELY, so a broken downstream = tight infinite loop
//   - a retry queue with TTL gives us exponential backoff for free
//   - the number of retries is trackable via the x-death header, added
//     automatically by the broker each time a message is dead-lettered
// -----------------------------------------------------------------------------
const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        // -- Main exchange (topic) --
        await channel.assertExchange(RABBITMQ_EXCHANGE, "topic", { durable: true });

        // -- Retry exchange (direct — routes to the retry queue by name) --
        await channel.assertExchange(RABBITMQ_RETRY_EXCHANGE, "direct", { durable: true });

        // -- Main queue with dead-letter args pointing at the retry exchange --
        // Any message we nack(false, false) will be routed to
        // RABBITMQ_RETRY_EXCHANGE with the SAME routing key (BOOKING_CREATED etc.)
        await channel.assertQueue(RABBITMQ_QUEUE, {
            durable: true,
            arguments: {
                "x-dead-letter-exchange": RABBITMQ_RETRY_EXCHANGE,
            },
        });

        // -- Retry queue --
        // Dead-letter args point BACK to the main exchange with each message's
        // original routing key. So after the retry-queue TTL expires, the
        // message re-enters the main queue for another attempt.
        // TTL is set per-message (in the consumer) so we can back off
        // exponentially by attempt count.
        await channel.assertQueue(RABBITMQ_RETRY_QUEUE, {
            durable: true,
            arguments: {
                "x-dead-letter-exchange": RABBITMQ_EXCHANGE,
            },
        });
        // Bind retry queue to the retry exchange with a wildcard so it accepts
        // messages regardless of the original routing key.
        for (const eventName of Object.values(EVENTS)) {
            await channel.bindQueue(RABBITMQ_RETRY_QUEUE, RABBITMQ_RETRY_EXCHANGE, eventName);
        }

        // -- Parking queue for terminal failures --
        // We publish to this directly from the consumer once retries are used up.
        // No dead-letter args — it just sits until an admin replays or drops it.
        await channel.assertQueue(RABBITMQ_PARKING_QUEUE, { durable: true });

        // -- Bind main queue to main exchange, one binding per event --
        // A topic "*" only wildcards a single dot-delimited word, so a pattern
        // like "BOOKING_*" matches nothing against a key like "BOOKING_CREATED".
        // Bind explicitly per event to keep the routing correct.
        for (const eventName of Object.values(EVENTS)) {
            await channel.bindQueue(RABBITMQ_QUEUE, RABBITMQ_EXCHANGE, eventName);
        }

        // Prefetch: process one message at a time per consumer. Simple and safe;
        // increase if handlers ever do meaningful I/O in parallel.
        await channel.prefetch(1);

        console.log("[notification-service] RabbitMQ connected + retry topology ready");
        return channel;
    } catch (error) {
        console.error("RabbitMQ Connection Failed:", error.message);
        process.exit(1);
    }
};

const getChannel = () => channel;

module.exports = { connectRabbitMQ, getChannel };
