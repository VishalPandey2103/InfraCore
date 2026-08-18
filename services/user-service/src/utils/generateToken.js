const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/envConfig");

// Every token gets a unique `jti` (JWT ID, RFC 7519 §4.1.7).
// The gateway keys blacklist lookups on this. Without a jti we could only
// revoke ALL of a user's tokens at once — which is fine for password reset
// but wrong for a single-device logout.
const generateToken = (payload) => {
    const jti = crypto.randomUUID();
    return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

module.exports = generateToken;
