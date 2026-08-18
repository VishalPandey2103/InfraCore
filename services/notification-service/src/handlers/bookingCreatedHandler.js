const notifier = require("../services/notifierService");

module.exports = async (data) => {
    await notifier.send(
        data.userId,
        `Booking submitted: ${data.itemName}`,
        `Your booking request for "${data.itemName}" has been submitted and is pending the owner's approval.`
    );
    await notifier.send(
        data.ownerId,
        `New booking request: ${data.itemName}`,
        `Someone requested to borrow your item "${data.itemName}". Approve or reject it from your bookings.`
    );
};
