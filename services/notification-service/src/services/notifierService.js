// In dev, we log to console. Swap this for nodemailer or Twilio in production.
// recipientId is the user id the message is addressed to (borrower or item owner).
const send = (recipientId, subject, body) => {
    console.log("\n===== NOTIFICATION =====");
    console.log("To:     ", recipientId);
    console.log("Subject:", subject);
    console.log("Body:   ", body);
    console.log("========================\n");
};

module.exports = { send };
