const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/envConfig");
const { getRedis, isRedisReady } = require("../config/redisConfig");

// Every issued token has a unique `jti` (JWT ID). On logout / revocation the
// user service SETs a Redis key `bl:jti:<jti>` with TTL = token's remaining
// lifetime. This middleware checks that key on every request.
//
// Why Redis instead of a MongoDB "tokenVersion" field:
//   - JWT verify stays constant-time (O(1) Redis GET vs O(log n) Mongo index hit)
//   - No round-trip to user-service on every request
//   - Keys auto-expire when the token would have expired anyway
//
// If Redis is down we fail OPEN on the blacklist check (accept the token).
// Locking every user out during a Redis outage is worse than briefly serving
// a revoked token — which would have been valid for hours or days anyway.
const verifyJwt = async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Missing or invalid Authorization header",
        });
    }

    const token = header.split(" ")[1];

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    // Blacklist check — only meaningful if the token carries a jti
    if (decoded.jti && isRedisReady()) {
        try {
            const revoked = await getRedis().get(`bl:jti:${decoded.jti}`);
            if (revoked) {
                return res.status(401).json({
                    success: false,
                    message: "Token has been revoked",
                });
            }
        } catch (err) {
            console.error("[gateway] blacklist check failed:", err.message);
            // fall through — fail open
        }
    }

    req.user = {
        id: decoded.id,
        role: decoded.role,
        jti: decoded.jti,
        exp: decoded.exp, // seconds since epoch; used by /logout to size the blacklist TTL
    };
    next();
};

module.exports = verifyJwt;
