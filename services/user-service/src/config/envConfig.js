const dotenv = require("dotenv");

dotenv.config();

module.exports = {
    PORT: process.env.PORT || 4000,
    MONGODB_URI: process.env.MONGODB_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
    // Shared with gateway — the gateway reads blacklist keys we write here.
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
};
