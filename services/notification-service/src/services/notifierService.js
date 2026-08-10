// In dev, we log to console. Swap this for nodemailer or Twilio in production.
const send = (subject, body) => {
    console.log("\n===== NOTIFICATION =====");
    console.log("Subject:", subject);
    console.log("Body:   ", body);
    console.log("========================\n");
};

module.exports = { send };
