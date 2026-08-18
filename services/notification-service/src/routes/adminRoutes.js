const express = require("express");
const adminAuth = require("../middlewares/adminAuthMiddleware");
const {
    parkingDepth,
    parkingPeek,
    parkingReplay,
    parkingPurge,
} = require("../controllers/adminController");

const router = express.Router();

router.use(adminAuth);

router.get("/parking/depth", parkingDepth);
router.get("/parking/peek", parkingPeek);
router.post("/parking/replay", parkingReplay);
router.delete("/parking", parkingPurge);

module.exports = router;
