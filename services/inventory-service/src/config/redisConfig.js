const { createClient } = require("redis");
const { REDIS_URL } = require("./envConfig");

let client = null;

// Graceful degradation: on Redis failure we fall through to Mongo. Cache
// becomes a no-op, but the service keeps serving.
const connectRedis = async () => {
    client = createClient({ url: REDIS_URL });

    client.on("error", (err) => {
        console.error("[inventory-service] Redis error:", err.message);
    });
    client.on("ready", () => {
        console.log("[inventory-service] Redis ready");
    });

    try {
        await client.connect();
    } catch (err) {
        console.error("[inventory-service] Redis initial connect failed:", err.message);
    }

    return client;
};

const getRedis = () => client;
const isRedisReady = () => Boolean(client && client.isOpen);

module.exports = { connectRedis, getRedis, isRedisReady };
