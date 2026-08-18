const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    PORT: process.env.PORT || 4001,
    MONGODB_URI: process.env.MONGODB_URI,
    INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
    // Short TTL keeps stale reads bounded even when a write happens on a
    // different pod that failed to invalidate (network glitch, race, etc.).
    CACHE_ITEM_TTL_SECONDS: parseInt(process.env.CACHE_ITEM_TTL_SECONDS || "300", 10),
    CACHE_LIST_TTL_SECONDS: parseInt(process.env.CACHE_LIST_TTL_SECONDS || "60", 10),
};
