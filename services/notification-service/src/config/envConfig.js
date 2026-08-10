const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    PORT: process.env.PORT || 4003,
    RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
    RABBITMQ_EXCHANGE: process.env.RABBITMQ_EXCHANGE || "infracore.events",
    RABBITMQ_QUEUE: process.env.RABBITMQ_QUEUE || "notification.bookings",
};
