const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    PORT: process.env.PORT || 4001,
    MONGODB_URI: process.env.MONGODB_URI,
};
