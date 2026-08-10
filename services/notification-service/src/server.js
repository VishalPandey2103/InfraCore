const app = require("./app");
const { PORT } = require("./config/envConfig");

const start = async () => {
    app.listen(PORT, () => {
        console.log(`Notification Service running on port ${PORT}`);
    });
};

start();
