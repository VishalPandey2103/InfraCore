const amqp = require("amqplib");
const { RABBITMQ_URL, RABBITMQ_EXCHANGE } = require("./envConfig");

let channel = null;

const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertExchange(RABBITMQ_EXCHANGE, "topic", { durable: true });
        console.log("RabbitMQ Connected");
    } catch (error) {
        console.error("RabbitMQ Connection Failed:", error.message);
        process.exit(1);
    }
};

const getChannel = () => channel;

module.exports = { connectRabbitMQ, getChannel };
