const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    PORT: process.env.PORT || 4003,
    RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://localhost:5672",
    RABBITMQ_EXCHANGE: process.env.RABBITMQ_EXCHANGE || "infracore.events",
    RABBITMQ_QUEUE: process.env.RABBITMQ_QUEUE || "notification.bookings",

    // ----- Dead-letter / retry topology -----
    // Failed messages flow: main queue -> retry queue (waits) -> back to main.
    // After MAX_RETRIES, message is parked in the parking queue for humans.
    RABBITMQ_RETRY_EXCHANGE: process.env.RABBITMQ_RETRY_EXCHANGE || "infracore.retry",
    RABBITMQ_RETRY_QUEUE: process.env.RABBITMQ_RETRY_QUEUE || "notification.bookings.retry",
    RABBITMQ_PARKING_QUEUE: process.env.RABBITMQ_PARKING_QUEUE || "notification.bookings.parking",

    // How long a message waits in the retry queue before being re-delivered
    // to the main queue (ms). Exponential backoff is applied per attempt.
    RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || "5000", 10),
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES || "3", 10),

    // Simple secret to guard the admin/replay endpoints. Rotate in production.
    ADMIN_API_SECRET: process.env.ADMIN_API_SECRET || "change-me",
};
