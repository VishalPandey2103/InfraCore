const { getChannel } = require("../config/rabbitmqConfig");
const {
    RABBITMQ_QUEUE,
    RABBITMQ_RETRY_EXCHANGE,
    RABBITMQ_RETRY_QUEUE,
    RABBITMQ_PARKING_QUEUE,
    RETRY_BASE_DELAY_MS,
    MAX_RETRIES,
} = require("../config/envConfig");
const handlers = require("../handlers");

// -----------------------------------------------------------------------------
// How the retry counter is read:
//
// Every time RabbitMQ dead-letters a message it adds (or increments) an entry
// in the x-death header, keyed by the queue the message died in.
//
// The entry to count is the RETRY queue's, not the main queue's. On failure we
// ack the original and hand-publish a copy to the retry exchange, so the main
// queue never dead-letters anything and never gets an x-death entry of its own.
// The only death the broker ever records is the retry queue's TTL expiry, and
// its "count" is exactly the number of completed retry cycles.
//
// Counting the main queue here instead is a silent infinite-retry bug: the
// count stays 0, `attempts >= MAX_RETRIES` is never true, and nothing is ever
// parked.
//
// Alternative: track a custom "x-retry-count" header we bump ourselves. Simpler
// to reason about but forces us to trust our own accounting rather than the
// broker's. x-death lets the broker do it for us.
// -----------------------------------------------------------------------------
const countPreviousAttempts = (msg) => {
    const deaths = msg.properties.headers && msg.properties.headers["x-death"];
    if (!Array.isArray(deaths)) return 0;
    const fromRetryQueue = deaths.find((d) => d.queue === RABBITMQ_RETRY_QUEUE);
    return fromRetryQueue ? fromRetryQueue.count : 0;
};

// Exponential backoff: 5s -> 10s -> 20s -> ...
const backoffMs = (attempt) => RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

// Route a message to the parking queue with a reason header so an admin can
// inspect why it died. Uses sendToQueue (bypasses exchange routing) because
// the parking queue has no bindings we want to reason about.
const parkMessage = (channel, msg, reason) => {
    channel.sendToQueue(RABBITMQ_PARKING_QUEUE, msg.content, {
        persistent: true,
        headers: {
            ...(msg.properties.headers || {}),
            "x-parking-reason": reason,
            "x-parking-time": new Date().toISOString(),
            "x-original-routing-key": msg.fields.routingKey,
        },
    });
};

const startConsumer = () => {
    const channel = getChannel();
    if (!channel) {
        throw new Error("RabbitMQ channel not initialized");
    }

    channel.consume(RABBITMQ_QUEUE, async (msg) => {
        if (!msg) return;

        // -- 1. Parse. Malformed payload = poison message, straight to parking. --
        let payload;
        try {
            payload = JSON.parse(msg.content.toString());
        } catch (err) {
            console.error("[notification-service] malformed payload, parking:", err.message);
            parkMessage(channel, msg, `parse-error: ${err.message}`);
            channel.ack(msg);
            return;
        }

        const handler = handlers[payload.eventName];
        if (!handler) {
            console.warn("[notification-service] no handler for", payload.eventName, "— parking");
            parkMessage(channel, msg, `no-handler:${payload.eventName}`);
            channel.ack(msg);
            return;
        }

        // -- 2. Attempt the handler. --
        try {
            // Wrapped in Promise.resolve so sync handlers still work.
            await Promise.resolve(handler(payload.data));
            channel.ack(msg);
        } catch (err) {
            const attempts = countPreviousAttempts(msg);
            console.error(
                `[notification-service] handler failed (attempt ${attempts + 1}/${MAX_RETRIES + 1}) for ${payload.eventName}:`,
                err.message
            );

            if (attempts >= MAX_RETRIES) {
                // -- 3a. Retries exhausted -> parking queue, ack the original. --
                parkMessage(channel, msg, `max-retries-exceeded: ${err.message}`);
                channel.ack(msg);
                return;
            }

            // -- 3b. Republish through the retry exchange with a TTL. --
            // We CANNOT use nack(false, false) here because the retry queue
            // uses one TTL for all messages by default, and we want per-message
            // backoff. So we ack the original and publish a new copy to the
            // retry exchange with a per-message TTL (expiration property).
            const delay = backoffMs(attempts);
            channel.publish(RABBITMQ_RETRY_EXCHANGE, msg.fields.routingKey, msg.content, {
                persistent: true,
                expiration: String(delay),
                headers: msg.properties.headers, // preserves x-death chain
            });
            channel.ack(msg);
        }
    });

    console.log(`[notification-service] consuming from ${RABBITMQ_QUEUE} (max ${MAX_RETRIES} retries)`);
};

module.exports = { startConsumer };
