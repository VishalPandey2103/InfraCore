const AppError = require("../utils/appError");

// Gateway-trust auth: reads x-user-id and x-user-role from headers.
// Does NOT verify the JWT - the gateway does that and strips the raw token
// before forwarding, so there is no Authorization header to read here.
// This service still owns JWT_SECRET for *signing* tokens at login.
const auth = (req, res, next) => {
    const userId = req.headers["x-user-id"];
    const userRole = req.headers["x-user-role"];

    if (!userId || !userRole) {
        return next(new AppError("Missing gateway identity headers", 401));
    }

    req.user = { id: userId, role: userRole };
    next();
};

module.exports = auth;
