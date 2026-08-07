const app = require("./app");
const { PORT } = require("./config/envConfig");
const connectDB = require("./config/dbConfig");

const startServer = async () => {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`User Service is running on port ${PORT}`);
    });
};

startServer();