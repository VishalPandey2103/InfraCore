const EVENTS = require("../events/eventNames");

const bookingCreated = require("./bookingCreatedHandler");
const bookingApproved = require("./bookingApprovedHandler");
const bookingRejected = require("./bookingRejectedHandler");
const bookingCancelled = require("./bookingCancelledHandler");
const bookingReturned = require("./bookingReturnedHandler");

module.exports = {
    [EVENTS.BOOKING_CREATED]: bookingCreated,
    [EVENTS.BOOKING_APPROVED]: bookingApproved,
    [EVENTS.BOOKING_REJECTED]: bookingRejected,
    [EVENTS.BOOKING_CANCELLED]: bookingCancelled,
    [EVENTS.BOOKING_RETURNED]: bookingReturned,
};
