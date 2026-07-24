const express = require("express");

const healthRoutes = require("./routes/health.routes");

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use("/api/v1", healthRoutes);

module.exports = app;