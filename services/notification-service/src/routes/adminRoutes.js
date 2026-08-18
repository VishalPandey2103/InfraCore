const express = require("express");
const adminAuth = require("../middlewares/adminAuthMiddleware");
const {
    parkingDepth,
    parkingPeek,
    parkingReplay,
    parkingPurge,
} = require("../controllers/adminController");

const router = express.Router();

// All /admin routes require the shared admin secret in x-admin-secret header.
router.use(adminAuth);

router.get("/parking/depth", parkingDepth);
router.get("/parking/peek", parkingPeek);
router.post("/parking/replay", parkingReplay);
router.delete("/parking", parkingPurge);

module.exports = router;
