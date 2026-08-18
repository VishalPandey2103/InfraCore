const notifier = require("../services/notifierService");

module.exports = async (data) => {
    await notifier.send(
        data.userId,
        `Item returned: ${data.itemName}`,
        `The return of "${data.itemName}" has been confirmed by the owner. Thank you.`
    );
};
