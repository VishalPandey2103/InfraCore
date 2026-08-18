const { createClient } = require("redis");
const { REDIS_URL } = require("./envConfig");

let client = null;

// Same graceful-degradation policy as the gateway. If Redis is down we still
// let the user service serve requests — logout just won't revoke immediately,
// and tokens will expire at their natural JWT expiry.
const connectRedis = async () => {
    client = createClient({ url: REDIS_URL });

    client.on("error", (err) => {
        console.error("[user-service] Redis error:", err.message);
    });
    client.on("ready", () => {
        console.log("[user-service] Redis ready");
    });

    try {
        await client.connect();
    } catch (err) {
        console.error("[user-service] Redis initial connect failed:", err.message);
    }

    return client;
};

const getRedis = () => client;
const isRedisReady = () => Boolean(client && client.isOpen);

module.exports = { connectRedis, getRedis, isRedisReady };
