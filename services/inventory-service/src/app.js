const express = require("express");
const routes = require("./routes");
const notFound = require("./middlewares/notFoundMiddleware");
const errorHandler = require("./middlewares/errorMiddleware");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ success: true, message: "Inventory Service is healthy" });
});

app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
