const AppError = require("../utils/appError");

// Gateway-trust: reads x-user-id and x-user-role headers set by the API Gateway.
// Does NOT verify JWT. Only the gateway does that.
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
