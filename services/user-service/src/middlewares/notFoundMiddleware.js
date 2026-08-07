const AppError = require("../utils/appError");

const notFound = (req, res, next) => {
    next(new AppError("Route not found", 404));
};

module.exports = notFound;
