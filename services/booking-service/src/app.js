const express = require("express");
const notFound = require("./middlewares/notFoundMiddleware");
const errorHandler = require("./middlewares/errorMiddleware");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ success: true, message: "Booking Service is healthy" });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
