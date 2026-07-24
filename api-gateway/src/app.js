const express = require("express");

const routes = require("./routes");
const notFound = require("./middlewares/notFound.middleware");
const errorHandler = require("./middlewares/error.middleware");

const app = express();

app.use(express.json());

app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;