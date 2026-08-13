const express = require("express");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
    createBooking,
    listMyBookings,
    listOwnerBookings,
    listAllBookings,
    getBookingById,
    approveBooking,
    rejectBooking,
    cancelBooking,
    returnBooking,
} = require("../controllers/bookingController");

const router = express.Router();

// Any authenticated user can book items and manage bookings on items they own.
// Per-transition authorization (borrower vs owner vs admin) lives in the service.
router.post("/", auth, createBooking);
router.get("/me", auth, listMyBookings);
router.get("/owner", auth, listOwnerBookings);
router.get("/", auth, role("RESOURCE_MANAGER", "ADMIN"), listAllBookings);
router.get("/:id", auth, getBookingById);

router.patch("/:id/approve", auth, approveBooking);
router.patch("/:id/reject",  auth, rejectBooking);
router.patch("/:id/return",  auth, returnBooking);
router.patch("/:id/cancel",  auth, cancelBooking);

module.exports = router;
