const notifier = require("../services/notifierService");

module.exports = (data) => {
    notifier.send(
        `Booking rejected: ${data.itemName}`,
        `Your booking request for "${data.itemName}" was rejected.`
    );
};
