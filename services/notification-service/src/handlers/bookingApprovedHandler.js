const notifier = require("../services/notifierService");

module.exports = (data) => {
    notifier.send(
        `Booking approved: ${data.itemName}`,
        `Your booking request for "${data.itemName}" has been approved. You may collect the item.`
    );
};
