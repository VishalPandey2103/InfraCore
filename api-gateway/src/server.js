const app = require("./app");
const { PORT } = require("./config/envConfig");
const { connectRedis } = require("./config/redisConfig");

const start = async () => {
    // Attempt Redis connection first. On failure we log and continue —
    // the middlewares degrade gracefully (see redisConfig.js).
    await connectRedis();

    app.listen(PORT, () => {
        console.log(`API Gateway running on port ${PORT}`);
    });
};

start();
