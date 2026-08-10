const notifier = require("../services/notifierService");

module.exports = (data) => {
    notifier.send(
        `Item returned: ${data.itemName}`,
        `The item "${data.itemName}" has been marked as returned. Thank you.`
    );
};
