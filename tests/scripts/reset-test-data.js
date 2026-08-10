/**
 * Wipes the data you created while testing, so you can start clean.
 *
 * Deletes:
 *   all bookings
 *   all inventory items
 *   all users EXCEPT admin@infracore.test
 *
 * It refuses to run without --yes, because it does not try to guess which
 * rows were "test" rows. Do not point this at anything you care about.
 *
 *   node tests/scripts/reset-test-data.js --yes
 *   node tests/scripts/reset-test-data.js --yes --all    (also removes the admin)
 */

const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const USER_SERVICE = path.join(ROOT, "services", "user-service");
const req = (m) => require(path.join(USER_SERVICE, "node_modules", m));

const mongoose = req("mongoose");
const dotenv = req("dotenv");

const CONFIRMED = process.argv.includes("--yes");
const KEEP_ADMIN = !process.argv.includes("--all");
const ADMIN_EMAIL = "admin@infracore.test";

if (!CONFIRMED) {
    console.log("This deletes ALL users (except the admin), items and bookings.");
    console.log("Re-run with --yes if that is what you want:\n");
    console.log("  node tests/scripts/reset-test-data.js --yes\n");
    process.exit(1);
}

const uriFor = (service) => {
    const parsed = dotenv.config({
        path: path.join(ROOT, "services", service, ".env"),
        override: true,
    });
    return parsed.parsed && parsed.parsed.MONGODB_URI;
};

const withDb = async (service, fn) => {
    const uri = uriFor(service);
    if (!uri) {
        console.log(`${service}: no MONGODB_URI in .env, skipped`);
        return;
    }
    const conn = await mongoose.createConnection(uri).asPromise();
    try {
        await fn(conn.db);
    } finally {
        await conn.close();
    }
};

(async () => {
    await withDb("booking-service", async (db) => {
        const r = await db.collection("bookings").deleteMany({});
        console.log(`bookings: deleted ${r.deletedCount}`);
    });

    await withDb("inventory-service", async (db) => {
        const r = await db.collection("items").deleteMany({});
        console.log(`items:    deleted ${r.deletedCount}`);
    });

    await withDb("user-service", async (db) => {
        const filter = KEEP_ADMIN ? { email: { $ne: ADMIN_EMAIL } } : {};
        const r = await db.collection("users").deleteMany(filter);
        console.log(`users:    deleted ${r.deletedCount}` + (KEEP_ADMIN ? " (admin kept)" : ""));
    });

    console.log("\nDone. Run bootstrap-admin.js again if you used --all.");
})().catch((err) => {
    console.error("Reset failed:", err.message);
    process.exit(1);
});
