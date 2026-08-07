const app = require("./app");
const { PORT } = require("./config/envConfig");
const connectDB = require("./config/dbConfig");

const start = async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`User Service running on port ${PORT}`);
    });
};

start();
