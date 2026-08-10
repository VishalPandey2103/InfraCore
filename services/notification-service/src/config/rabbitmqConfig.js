const amqp = require("amqplib");
const { RABBITMQ_URL, RABBITMQ_EXCHANGE, RABBITMQ_QUEUE } = require("./envConfig");

let channel = null;

const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        await channel.assertExchange(RABBITMQ_EXCHANGE, "topic", { durable: true });
        await channel.assertQueue(RABBITMQ_QUEUE, { durable: true });

        // bind the queue to all BOOKING_* routing keys on the exchange
        await channel.bindQueue(RABBITMQ_QUEUE, RABBITMQ_EXCHANGE, "BOOKING_*");

        console.log("RabbitMQ Connected");
        return channel;
    } catch (error) {
        console.error("RabbitMQ Connection Failed:", error.message);
        process.exit(1);
    }
};

const getChannel = () => channel;

module.exports = { connectRabbitMQ, getChannel };
