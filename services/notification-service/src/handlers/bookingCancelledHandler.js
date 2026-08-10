const notifier = require("../services/notifierService");

module.exports = (data) => {
    notifier.send(
        `Booking cancelled: ${data.itemName}`,
        `Your booking for "${data.itemName}" has been cancelled.`
    );
};
