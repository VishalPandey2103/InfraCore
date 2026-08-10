const { getChannel } = require("../config/rabbitmqConfig");
const { RABBITMQ_QUEUE } = require("../config/envConfig");
const handlers = require("../handlers");

const startConsumer = () => {
    const channel = getChannel();
    if (!channel) {
        throw new Error("RabbitMQ channel not initialized");
    }

    channel.consume(RABBITMQ_QUEUE, (msg) => {
        if (!msg) return;

        try {
            const payload = JSON.parse(msg.content.toString());
            const handler = handlers[payload.eventName];

            if (handler) {
                handler(payload.data);
            } else {
                console.warn("No handler for event:", payload.eventName);
            }

            channel.ack(msg);
        } catch (error) {
            console.error("Error processing message:", error.message);
            channel.nack(msg, false, false); // discard bad message
        }
    });

    console.log(`Consuming events from queue: ${RABBITMQ_QUEUE}`);
};

module.exports = { startConsumer };
