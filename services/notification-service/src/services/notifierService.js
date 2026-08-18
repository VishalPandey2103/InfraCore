// In dev, we log to console. Swap this for nodemailer or Twilio in production.
// recipientId is the user id the message is addressed to (borrower or item owner).
//
// The notify function is async and MAY throw. The consumer treats a throw as
// "delivery failed → retry" (see events/consumer.js). In production, real
// SMTP calls fail intermittently (rate limits, transient DNS, provider outages)
// and this contract makes the retry / DLQ machinery meaningful.
//
// The FORCE_FAILURE_RATE env var lets you inject synthetic failures to
// demonstrate the retry pipeline end-to-end. Set to e.g. 0.5 for 50% failures.
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
