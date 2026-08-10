const notifier = require("../services/notifierService");

module.exports = (data) => {
    notifier.send(
        `Booking submitted: ${data.itemName}`,
        `Your booking request for "${data.itemName}" has been submitted and is pending approval.`
    );
};
