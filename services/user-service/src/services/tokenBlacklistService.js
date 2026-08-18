const { getRedis, isRedisReady } = require("../config/redisConfig");

// Blacklist a JWT by its jti. TTL is set to the token's remaining lifetime
// so Redis auto-evicts the key exactly when the token would have expired on
// its own — no manual cleanup, no unbounded growth.
//
// key format: bl:jti:<jti>
// value:      the reason (for auditing / debugging; not read by the gateway)
const revoke = async (jti, exp, reason = "logout") => {
    if (!jti || !exp) return;
    if (!isRedisReady()) {
        // Best-effort. Logged so ops can spot revocations lost during outages.
        console.warn("[user-service] Redis down — token", jti, "not blacklisted");
        return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttl = exp - nowSeconds;

    // If the token is already expired, no point storing anything.
    if (ttl <= 0) return;

    try {
        await getRedis().set(`bl:jti:${jti}`, reason, { EX: ttl });
    } catch (err) {
        console.error("[user-service] blacklist write failed:", err.message);
    }
};

module.exports = { revoke };
