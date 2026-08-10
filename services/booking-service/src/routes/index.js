const express = require("express");
const bookingRoutes = require("./bookingRoutes");

const router = express.Router();
router.use("/bookings", bookingRoutes);

module.exports = router;
