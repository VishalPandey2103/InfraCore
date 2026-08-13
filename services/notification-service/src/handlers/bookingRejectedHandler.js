const notifier = require("../services/notifierService");

module.exports = (data) => {
    notifier.send(
        data.userId,
        `Booking rejected: ${data.itemName}`,
        `Your booking request for "${data.itemName}" was rejected by the owner.`
    );
};
