const app = require("./app");
const { PORT } = require("./config/envConfig");
const connectDB = require("./config/dbConfig");
const { connectRabbitMQ } = require("./config/rabbitmqConfig");

const start = async () => {
    await connectDB();
    await connectRabbitMQ();
    app.listen(PORT, () => {
        console.log(`Booking Service running on port ${PORT}`);
    });
};

start();
