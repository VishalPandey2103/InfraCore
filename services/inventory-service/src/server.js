const app = require("./app");
const { PORT } = require("./config/envConfig");
const connectDB = require("./config/dbConfig");
const { connectRedis } = require("./config/redisConfig");

const start = async () => {
    await connectDB();
    await connectRedis();
    app.listen(PORT, () => {
        console.log(`Inventory Service running on port ${PORT}`);
    });
};

start();
