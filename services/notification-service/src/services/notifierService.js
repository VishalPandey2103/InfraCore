const FORCE_FAILURE_RATE = parseFloat(process.env.FORCE_FAILURE_RATE || "0");

const send = async (recipientId, subject, body) => {
    if (FORCE_FAILURE_RATE > 0 && Math.random() < FORCE_FAILURE_RATE) {
        throw new Error("Simulated notifier failure");
    }

    console.log("\n===== NOTIFICATION =====");
    console.log("To:     ", recipientId);
    console.log("Subject:", subject);
    console.log("Body:   ", body);
    console.log("========================\n");
};

module.exports = { send };
