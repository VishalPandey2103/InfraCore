/**
 * Creates the first ADMIN user.
 *
 * Why this script exists: authService.register() hard-codes role "STUDENT",
 * and PATCH /users/:id/role requires an existing ADMIN. So the very first
 * admin cannot be created through the API at all - it has to be written
 * straight to the database.
 *
 * Safe to re-run: it upserts, so it just resets the password and role.
 *
 *   node tests/scripts/bootstrap-admin.js
 */

const path = require("path");

const USER_SERVICE = path.join(__dirname, "..", "..", "services", "user-service");
const req = (m) => require(path.join(USER_SERVICE, "node_modules", m));

const mongoose = req("mongoose");
const bcrypt = req("bcryptjs");
req("dotenv").config({ path: path.join(USER_SERVICE, ".env") });

const EMAIL = process.env.ADMIN_EMAIL || "admin@infracore.test";
const PASSWORD = process.env.ADMIN_PASSWORD || "Admin@12345";

(async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("MONGODB_URI is not set in services/user-service/.env");
        process.exit(1);
    }

    await mongoose.connect(uri);

    const users = mongoose.connection.db.collection("users");
    const hashed = await bcrypt.hash(PASSWORD, 10);
    const now = new Date();

    await users.updateOne(
        { email: EMAIL },
        {
            $set: { name: "InfraCore Admin", password: hashed, role: "ADMIN", updatedAt: now },
            $setOnInsert: { createdAt: now, __v: 0 },
        },
        { upsert: true }
    );

    const admin = await users.findOne({ email: EMAIL });

    console.log("ADMIN ready");
    console.log("  email:    " + EMAIL);
    console.log("  password: " + PASSWORD);
    console.log("  id:       " + admin._id);
    console.log("\nThese match adminEmail / adminPassword in the Postman environment.");

    await mongoose.disconnect();
})().catch((err) => {
    console.error("Bootstrap failed:", err.message);
    process.exit(1);
});
