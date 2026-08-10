const express = require("express");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
    createBooking,
    listMyBookings,
    listAllBookings,
    getBookingById,
    approveBooking,
    rejectBooking,
    cancelBooking,
    returnBooking,
} = require("../controllers/bookingController");

const router = express.Router();

router.post("/", auth, role("STUDENT"), createBooking);
router.get("/me", auth, listMyBookings);
router.get("/", auth, role("RESOURCE_MANAGER", "ADMIN"), listAllBookings);
router.get("/:id", auth, getBookingById);

router.patch("/:id/approve", auth, role("RESOURCE_MANAGER", "ADMIN"), approveBooking);
router.patch("/:id/reject",  auth, role("RESOURCE_MANAGER", "ADMIN"), rejectBooking);
router.patch("/:id/return",  auth, role("RESOURCE_MANAGER", "ADMIN"), returnBooking);
router.patch("/:id/cancel",  auth, role("STUDENT"), cancelBooking);

module.exports = router;
