const app = require("./app");
const { PORT } = require("./config/envConfig");
const { connectRabbitMQ } = require("./config/rabbitmqConfig");

const start = async () => {
    await connectRabbitMQ();
    app.listen(PORT, () => {
        console.log(`Notification Service running on port ${PORT}`);
    });
};

start();
