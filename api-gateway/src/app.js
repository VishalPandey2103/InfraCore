const express = require("express");

const healthRoutes = require("./routes/healthRoutes");
const notFound = require("./middlewares/notFoundMiddleware");
const errorHandler = require("./middlewares/errorMiddleware");

const app = express();

app.use(express.json());

app.use("/health", healthRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
