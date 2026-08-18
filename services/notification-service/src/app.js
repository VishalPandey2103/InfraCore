const express = require("express");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ success: true, message: "Notification Service is healthy" });
});

// Admin/DLQ operations. Guarded by shared secret inside the router.
app.use("/admin", adminRoutes);

app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route not found" });
});

// Basic error handler so admin route errors don't crash the process.
// (No global error middleware existed in the original notification service.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("[notification-service] unhandled:", err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal error",
    });
});

module.exports = app;
