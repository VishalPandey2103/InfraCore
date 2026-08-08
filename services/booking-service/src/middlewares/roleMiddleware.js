const AppError = require("../utils/appError");

const role = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return next(new AppError("Forbidden: insufficient permissions", 403));
        }
        next();
    };
};

module.exports = role;
