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
const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        await channel.assertExchange(RABBITMQ_EXCHANGE, "topic", { durable: true });
        await channel.assertExchange(RABBITMQ_RETRY_EXCHANGE, "direct", { durable: true });

        await channel.assertQueue(RABBITMQ_QUEUE, {
            durable: true,
            arguments: {
                "x-dead-letter-exchange": RABBITMQ_RETRY_EXCHANGE,
            },
        });

        await channel.assertQueue(RABBITMQ_RETRY_QUEUE, {
            durable: true,
            arguments: {
                "x-dead-letter-exchange": RABBITMQ_EXCHANGE,
            },
        });
        for (const eventName of Object.values(EVENTS)) {
            await channel.bindQueue(RABBITMQ_RETRY_QUEUE, RABBITMQ_RETRY_EXCHANGE, eventName);
        }

        await channel.assertQueue(RABBITMQ_PARKING_QUEUE, { durable: true });

        for (const eventName of Object.values(EVENTS)) {
            await channel.bindQueue(RABBITMQ_QUEUE, RABBITMQ_EXCHANGE, eventName);
        }

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
