const notifier = require("../services/notifierService");

module.exports = (data) => {
    notifier.send(
        data.userId,
        `Booking approved: ${data.itemName}`,
        `Your booking request for "${data.itemName}" has been approved by the owner. You may collect the item.`
    );
};
