const amqp = require("amqplib");
const { RABBITMQ_URL, RABBITMQ_EXCHANGE, RABBITMQ_QUEUE } = require("./envConfig");
const EVENTS = require("../events/eventNames");

let channel = null;

const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        await channel.assertExchange(RABBITMQ_EXCHANGE, "topic", { durable: true });
        await channel.assertQueue(RABBITMQ_QUEUE, { durable: true });

        // Bind one routing key per event.
        // A topic-exchange "*" only wildcards a whole dot-delimited word, so a
        // pattern like "BOOKING_*" matches nothing against a key such as
        // "BOOKING_CREATED" - the exchange would silently drop every message.
        for (const eventName of Object.values(EVENTS)) {
            await channel.bindQueue(RABBITMQ_QUEUE, RABBITMQ_EXCHANGE, eventName);
        }

        console.log("RabbitMQ Connected");
        return channel;
    } catch (error) {
        console.error("RabbitMQ Connection Failed:", error.message);
        process.exit(1);
    }
};

const getChannel = () => channel;

module.exports = { connectRabbitMQ, getChannel };
