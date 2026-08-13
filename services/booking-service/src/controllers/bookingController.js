const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const AppError = require("../utils/appError");
const bookingService = require("../services/bookingService");
const { validateCreateBooking } = require("../validators/bookingValidator");

const createBooking = asyncHandler(async (req, res) => {
    const { valid, errors } = validateCreateBooking(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }
    const booking = await bookingService.createBooking({
        itemId: req.body.itemId,
        userId: req.user.id,
        userRole: req.user.role,
    });
    res.status(201).json(new ApiResponse(true, "Booking created", booking));
});

const listMyBookings = asyncHandler(async (req, res) => {
    const bookings = await bookingService.listMyBookings(req.user.id);
    res.json(new ApiResponse(true, "Bookings fetched", bookings));
});

const listAllBookings = asyncHandler(async (req, res) => {
    const bookings = await bookingService.listAllBookings();
    res.json(new ApiResponse(true, "Bookings fetched", bookings));
});

// Incoming requests on items the caller has published.
const listOwnerBookings = asyncHandler(async (req, res) => {
    const bookings = await bookingService.listOwnerBookings(req.user.id);
    res.json(new ApiResponse(true, "Bookings fetched", bookings));
});

const getBookingById = asyncHandler(async (req, res) => {
    const booking = await bookingService.getBookingById(req.params.id);
    // visible to the borrower, the item's owner, and staff
    const isBorrower = booking.userId === req.user.id;
    const isOwner = booking.ownerId === req.user.id;
    const isStaff = req.user.role === "ADMIN" || req.user.role === "RESOURCE_MANAGER";
    if (!isBorrower && !isOwner && !isStaff) {
        throw new AppError("Forbidden", 403);
    }
    res.json(new ApiResponse(true, "Booking fetched", booking));
});

const makeStatusHandler = (newStatus) =>
    asyncHandler(async (req, res) => {
        const booking = await bookingService.changeStatus({
            bookingId: req.params.id,
            newStatus,
            userId: req.user.id,
            userRole: req.user.role,
            remarks: req.body ? req.body.remarks : "",
        });
        res.json(new ApiResponse(true, `Booking ${newStatus.toLowerCase()}`, booking));
    });

module.exports = {
    createBooking,
    listMyBookings,
    listOwnerBookings,
    listAllBookings,
    getBookingById,
    approveBooking: makeStatusHandler("APPROVED"),
    rejectBooking: makeStatusHandler("REJECTED"),
    cancelBooking: makeStatusHandler("CANCELLED"),
    returnBooking: makeStatusHandler("RETURNED"),
};
