const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    PORT: process.env.PORT || 4002,
    MONGODB_URI: process.env.MONGODB_URI,
    INVENTORY_SERVICE_URL: process.env.INVENTORY_SERVICE_URL || "http://localhost:4001",
    INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
    RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
    RABBITMQ_EXCHANGE: process.env.RABBITMQ_EXCHANGE || "infracore.events",
};
