const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    PORT: process.env.PORT || 3000,
    JWT_SECRET: process.env.JWT_SECRET,
    USER_SERVICE_URL: process.env.USER_SERVICE_URL || "http://localhost:4000",
    INVENTORY_SERVICE_URL: process.env.INVENTORY_SERVICE_URL || "http://localhost:4001",
    BOOKING_SERVICE_URL: process.env.BOOKING_SERVICE_URL || "http://localhost:4002",
};
