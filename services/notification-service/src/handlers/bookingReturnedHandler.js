const notifier = require("../services/notifierService");

module.exports = (data) => {
    // Borrower: the owner confirmed the return
    notifier.send(
        data.userId,
        `Item returned: ${data.itemName}`,
        `The return of "${data.itemName}" has been confirmed by the owner. Thank you.`
    );
};
