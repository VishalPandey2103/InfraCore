const notifier = require("../services/notifierService");

module.exports = (data) => {
    // Owner: the borrower withdrew their request
    notifier.send(
        data.ownerId,
        `Booking cancelled: ${data.itemName}`,
        `The booking request for your item "${data.itemName}" has been cancelled.`
    );
};
