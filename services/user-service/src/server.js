const app = require("./app");
const { PORT } = require("./config/env.config");
const connectDB = require("./config/db.config");

const startServer = async () => {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`User Service is running on port ${PORT}`);
    });
};

startServer();