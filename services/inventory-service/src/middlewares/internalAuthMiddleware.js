const AppError = require("../utils/appError");
const { INTERNAL_API_SECRET } = require("../config/envConfig");

// Service-to-service auth: trusted internal callers (e.g. booking-service)
// present a shared secret. The gateway strips this header from external
// requests, so no end user can ever reach an internal route.
const internalAuth = (req, res, next) => {
    const secret = req.headers["x-internal-secret"];

    if (!INTERNAL_API_SECRET || secret !== INTERNAL_API_SECRET) {
        return next(new AppError("Forbidden: internal endpoint", 403));
    }

    next();
};

module.exports = internalAuth;
