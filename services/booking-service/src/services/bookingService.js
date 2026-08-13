const Booking = require("../models/bookingModel");
const AppError = require("../utils/appError");
const { canTransition } = require("../utils/bookingState");
const inventoryClient = require("../clients/inventoryClient");
const { publish } = require("../events/publisher");
const EVENTS = require("../events/eventNames");

const createBooking = async ({ itemId, userId, userRole }) => {
    // 1. Verify item exists and is bookable (sync call to inventory-service)
    const item = await inventoryClient.getItem(itemId, userId, userRole);

    if (item.ownerId === userId) {
        throw new AppError("You cannot book your own item", 400);
    }
    if (!item.isListed || item.isOnLoan) {
        throw new AppError("Item is not available", 400);
    }

    // 2. Create booking in PENDING state (owner snapshot for later authz)
    const booking = await Booking.create({
        userId,
        itemId,
        itemName: item.name,
        ownerId: item.ownerId,
        status: "PENDING",
    });

    // 3. Emit event
    publish(EVENTS.BOOKING_CREATED, {
        bookingId: booking._id.toString(),
        userId,
        itemId,
        itemName: item.name,
        ownerId: item.ownerId,
    });

    return booking;
};

// Who may drive which transition:
//   CANCELLED                     -> the borrower (or ADMIN)
//   APPROVED / REJECTED / RETURNED -> the item's owner (or ADMIN)
const assertCanTransition = (booking, newStatus, userId, userRole) => {
    if (userRole === "ADMIN") return;

    if (newStatus === "CANCELLED") {
        if (booking.userId !== userId) {
            throw new AppError("You can only cancel your own bookings", 403);
        }
        return;
    }

    if (booking.ownerId !== userId) {
        throw new AppError("Only the item's owner can manage this booking", 403);
    }
};

const changeStatus = async ({ bookingId, newStatus, userId, userRole, remarks }) => {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
        throw new AppError("Booking not found", 404);
    }

    assertCanTransition(booking, newStatus, userId, userRole);

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

    // Loan lock in inventory-service (sync, internal auth).
    // APPROVED locks the item; RETURNED releases it. CANCELLED/REJECTED only
    // ever leave PENDING (see bookingState.js), where the item was never locked.
    if (newStatus === "APPROVED") {
        await inventoryClient.setLoanStatus(booking.itemId, true);
    }
    if (newStatus === "RETURNED") {
        await inventoryClient.setLoanStatus(booking.itemId, false);
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
        ownerId: booking.ownerId,
    });

    return booking;
};

const listMyBookings = async (userId) => {
    return await Booking.find({ userId }).sort({ createdAt: -1 });
};

// Incoming requests on items the user has published.
const listOwnerBookings = async (ownerId) => {
    return await Booking.find({ ownerId }).sort({ createdAt: -1 });
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
    listOwnerBookings,
    listAllBookings,
    getBookingById,
};
