const express = require("express");

const app = express();

app.get("/health", (req, res) => {
    res.json({ success: true, message: "Notification Service is healthy" });
});

app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route not found" });
});

module.exports = app;
