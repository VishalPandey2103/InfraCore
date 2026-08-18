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

const countPreviousAttempts = (msg) => {
    const deaths = msg.properties.headers && msg.properties.headers["x-death"];
    if (!Array.isArray(deaths)) return 0;
    const fromRetryQueue = deaths.find((d) => d.queue === RABBITMQ_RETRY_QUEUE);
    return fromRetryQueue ? fromRetryQueue.count : 0;
};

const backoffMs = (attempt) => RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

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

        try {
            await Promise.resolve(handler(payload.data));
            channel.ack(msg);
        } catch (err) {
            const attempts = countPreviousAttempts(msg);
            console.error(
                `[notification-service] handler failed (attempt ${attempts + 1}/${MAX_RETRIES + 1}) for ${payload.eventName}:`,
                err.message
            );

            if (attempts >= MAX_RETRIES) {
                parkMessage(channel, msg, `max-retries-exceeded: ${err.message}`);
                channel.ack(msg);
                return;
            }

            const delay = backoffMs(attempts);
            channel.publish(RABBITMQ_RETRY_EXCHANGE, msg.fields.routingKey, msg.content, {
                persistent: true,
                expiration: String(delay),
                headers: msg.properties.headers,
            });
            channel.ack(msg);
        }
    });

    console.log(`[notification-service] consuming from ${RABBITMQ_QUEUE} (max ${MAX_RETRIES} retries)`);
};

module.exports = { startConsumer };
