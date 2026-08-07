const app = require("./app");
const { PORT } = require("./config/envConfig");

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
