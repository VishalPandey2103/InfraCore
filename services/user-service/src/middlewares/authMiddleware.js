const AppError = require("../utils/appError");

// Gateway-trust auth: reads x-user-id / x-user-role from headers set by the
// gateway. Also picks up x-user-jti and x-user-exp when present — used by the
// /logout handler to blacklist the caller's own token.
const auth = (req, res, next) => {
    const userId = req.headers["x-user-id"];
    const userRole = req.headers["x-user-role"];

    if (!userId || !userRole) {
        return next(new AppError("Missing gateway identity headers", 401));
    }

    req.user = {
        id: userId,
        role: userRole,
        jti: req.headers["x-user-jti"],
        exp: parseInt(req.headers["x-user-exp"] || "0", 10),
    };
    next();
};

module.exports = auth;
