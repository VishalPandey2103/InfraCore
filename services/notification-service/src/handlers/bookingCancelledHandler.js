const notifier = require("../services/notifierService");

module.exports = async (data) => {
    // Owner: the borrower withdrew their request
    await notifier.send(
        data.ownerId,
        `Booking cancelled: ${data.itemName}`,
        `The booking request for your item "${data.itemName}" has been cancelled.`
    );
};
