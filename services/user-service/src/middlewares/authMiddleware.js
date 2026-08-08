const jwt = require("jsonwebtoken");
const AppError = require("../utils/appError");
const { JWT_SECRET } = require("../config/envConfig");

const auth = (req, res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return next(new AppError("Missing or invalid Authorization header", 401));
    }

    const token = header.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { id: decoded.id, role: decoded.role };
        next();
    } catch (err) {
        next(new AppError("Invalid or expired token", 401));
    }
};

module.exports = auth;
