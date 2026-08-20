const { getRedis, isRedisReady } = require("../config/redisConfig");
const {
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_SECONDS,
    RATE_LIMIT_AUTH_MAX,
    RATE_LIMIT_AUTH_WINDOW_SECONDS,
} = require("../config/envConfig");

// Fixed-window counter. Simple, correct enough for a single-tenant platform.
// Trade-off: at window boundaries a client can burst up to 2x the limit.
// A sliding-window log or token bucket would smooth that out at the cost of
// more Redis commands per request. Not worth it here.
//
// Algorithm (per request):
//   1. Build a key like "rl:user:<id>" or "rl:ip:<ip>"
//   2. INCR the key. INCR is atomic — no race between two concurrent requests.
//   3. If the returned count is 1, this is the first hit in the window, so
//      set EXPIRE to the window length. Without this, the key would live forever.
//   4. If count > max, return 429 with a Retry-After header.
//
// The key identity switches from IP to user id after the JWT middleware runs.
// Auth endpoints are IP-only (there is no user yet at login).
const buildLimiter = ({ max, windowSeconds, keyPrefix, keyResolver }) => {
    return async (req, res, next) => {
        // Fail-open: if Redis is unreachable we let the request through.
        if (!isRedisReady()) return next();

        const identity = keyResolver(req);
        if (!identity) return next(); // nothing to key on, skip

        const key = `rl:${keyPrefix}:${identity}`;
        const redis = getRedis();

        try {
            const count = await redis.incr(key);
            if (count === 1) {
                await redis.expire(key, windowSeconds);
            }
            const ttl = await redis.ttl(key);

            // Standard rate-limit headers — most HTTP clients understand these.
            res.setHeader("X-RateLimit-Limit", max);
            res.setHeader("X-RateLimit-Remaining", Math.max(0, max - count));
            res.setHeader("X-RateLimit-Reset", ttl);

            if (count > max) {
                res.setHeader("Retry-After", ttl);
                return res.status(429).json({
                    success: false,
                    message: "Too many requests. Please slow down.",
                });
            }

            next();
        } catch (err) {
            // Any Redis error → fail-open. Logged for observability.
            console.error("[gateway] rate limit error:", err.message);
            next();
        }
    };
};

// Public / auth endpoints — IP-based, stricter.
const authRateLimit = buildLimiter({
    max: RATE_LIMIT_AUTH_MAX,
    windowSeconds: RATE_LIMIT_AUTH_WINDOW_SECONDS,
    keyPrefix: "auth",
    keyResolver: (req) => req.ip,
});

// Authenticated endpoints — user-based (falls back to IP if req.user missing).
// Note this runs *after* verifyJwt, so req.user should always be set on
// protected paths. The fallback is defensive.
const userRateLimit = buildLimiter({
    max: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    keyPrefix: "user",
    keyResolver: (req) => (req.user && req.user.id) || req.ip,
});

module.exports = { authRateLimit, userRateLimit };
