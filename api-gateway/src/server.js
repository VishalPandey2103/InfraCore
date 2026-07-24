const app = require("./app");
const { PORT } = require("./config/env.config");

app.listen(PORT, () => {
    console.log(`API Gateway is running on port ${PORT}`);
});