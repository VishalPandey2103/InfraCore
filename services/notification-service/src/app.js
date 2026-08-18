const express = require("express");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ success: true, message: "Notification Service is healthy" });
});

app.use("/admin", adminRoutes);

app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("[notification-service] unhandled:", err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal error",
    });
});

module.exports = app;
