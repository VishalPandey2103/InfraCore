const app = require("./app");
const { PORT } = require("./config/envConfig");
const { connectRabbitMQ } = require("./config/rabbitmqConfig");
const { startConsumer } = require("./events/consumer");

const start = async () => {
    await connectRabbitMQ();
    startConsumer();
    app.listen(PORT, () => {
        console.log(`Notification Service running on port ${PORT}`);
    });
};

start();
