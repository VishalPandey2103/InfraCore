const express = require("express");

const healthRoutes = require("./routes/health.routes");

const app = express();

app.use("/api/v1", healthRoutes);

module.exports = app;