const { createClient } = require("redis");
const { REDIS_URL } = require("./envConfig");

let client = null;

// Graceful degradation: if Redis is down, we log and let the app run without it.
// Rate limiting and blacklist checks will short-circuit as "allow" so a Redis
// outage never takes down the whole platform. Trade-off: during an outage,
// abusive traffic gets through and revoked tokens work briefly. That is almost
// always preferable to a hard failure at the gateway.
const connectRedis = async () => {
    client = createClient({ url: REDIS_URL });

    client.on("error", (err) => {
        console.error("[gateway] Redis error:", err.message);
    });
    client.on("reconnecting", () => {
        console.warn("[gateway] Redis reconnecting...");
    });
    client.on("ready", () => {
        console.log("[gateway] Redis ready");
    });

    try {
        await client.connect();
    } catch (err) {
        console.error("[gateway] Redis initial connect failed:", err.message);
        // Do not exit. The middlewares handle a missing/disconnected client.
    }

    return client;
};

const getRedis = () => client;

// Every middleware that touches Redis must call this first — it hides both
// "client not created yet" and "client not open (network flap)" behind one check.
const isRedisReady = () => Boolean(client && client.isOpen);

module.exports = { connectRedis, getRedis, isRedisReady };
