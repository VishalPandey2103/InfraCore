const Booking = require("../models/bookingModel");
const AppError = require("../utils/appError");
const { canTransition } = require("../utils/bookingState");
const inventoryClient = require("../clients/inventoryClient");
const { publish } = require("../events/publisher");
const EVENTS = require("../events/eventNames");

const createBooking = async ({ itemId, userId, userRole }) => {
    // 1. Verify item exists and is available (sync call to inventory-service)
    const item = await inventoryClient.getItem(itemId, userId, userRole);

    if (!item.isAvailable) {
        throw new AppError("Item is not available", 400);
    }

    // 2. Create booking in PENDING state
    const booking = await Booking.create({
        userId,
        itemId,
        itemName: item.name,
        status: "PENDING",
    });

    // 3. Emit event
    publish(EVENTS.BOOKING_CREATED, {
        bookingId: booking._id.toString(),
        userId,
        itemId,
        itemName: item.name,
    });

    return booking;
};

const changeStatus = async ({ bookingId, newStatus, userId, userRole, remarks }) => {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
        throw new AppError("Booking not found", 404);
    }

    // For CANCELLED, ensure it's the owner
    if (newStatus === "CANCELLED" && booking.userId !== userId) {
        throw new AppError("You can only cancel your own bookings", 403);
    }

    if (!canTransition(booking.status, newStatus)) {
        throw new AppError(
            `Cannot transition from ${booking.status} to ${newStatus}`,
            400
        );
    }

    booking.status = newStatus;
    booking.remarks = remarks || booking.remarks;

    const now = new Date();
    if (newStatus === "APPROVED") booking.approvedAt = now;
    if (newStatus === "REJECTED") booking.rejectedAt = now;
    if (newStatus === "CANCELLED") booking.cancelledAt = now;
    if (newStatus === "RETURNED") booking.returnedAt = now;

    await booking.save();

    // Update item availability in inventory-service (sync)
    if (newStatus === "APPROVED") {
        await inventoryClient.setItemAvailability(booking.itemId, false, userId, userRole);
    }
    if (newStatus === "RETURNED" || newStatus === "CANCELLED" || newStatus === "REJECTED") {
        // Only flip back to available if it was previously approved (i.e., item was locked)
        if (newStatus === "RETURNED" || booking.status === "RETURNED") {
            await inventoryClient.setItemAvailability(booking.itemId, true, userId, userRole);
        }
    }

    // Emit event
    const eventMap = {
        APPROVED: EVENTS.BOOKING_APPROVED,
        REJECTED: EVENTS.BOOKING_REJECTED,
        CANCELLED: EVENTS.BOOKING_CANCELLED,
        RETURNED: EVENTS.BOOKING_RETURNED,
    };
    publish(eventMap[newStatus], {
        bookingId: booking._id.toString(),
        userId: booking.userId,
        itemId: booking.itemId,
        itemName: booking.itemName,
    });

    return booking;
};

const listMyBookings = async (userId) => {
    return await Booking.find({ userId }).sort({ createdAt: -1 });
};

const listAllBookings = async () => {
    return await Booking.find().sort({ createdAt: -1 });
};

const getBookingById = async (id) => {
    const booking = await Booking.findById(id);
    if (!booking) {
        throw new AppError("Booking not found", 404);
    }
    return booking;
};

module.exports = {
    createBooking,
    changeStatus,
    listMyBookings,
    listAllBookings,
    getBookingById,
};
