const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    PORT: process.env.PORT || 3000,
    JWT_SECRET: process.env.JWT_SECRET,
    USER_SERVICE_URL: process.env.USER_SERVICE_URL || "http://localhost:4000",
    INVENTORY_SERVICE_URL: process.env.INVENTORY_SERVICE_URL || "http://localhost:4001",
    BOOKING_SERVICE_URL: process.env.BOOKING_SERVICE_URL || "http://localhost:4002",

    // ----- Redis (rate limiting + JWT blacklist) -----
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",

    // Rate limit: N requests per WINDOW seconds per key (user id or IP)
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
    RATE_LIMIT_WINDOW_SECONDS: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || "60", 10),
    // Auth endpoints get a stricter limit to blunt brute-force attacks
    RATE_LIMIT_AUTH_MAX: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "10", 10),
    RATE_LIMIT_AUTH_WINDOW_SECONDS: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_SECONDS || "60", 10),
};
