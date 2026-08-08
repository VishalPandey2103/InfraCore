const express = require("express");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
    getMe,
    listUsers,
    getUserById,
    updateMe,
    changeUserRole,
} = require("../controllers/userController");

const router = express.Router();

router.get("/me", auth, getMe);
router.patch("/me", auth, updateMe);

router.get("/", auth, role("ADMIN"), listUsers);
router.get("/:id", auth, getUserById);
router.patch("/:id/role", auth, role("ADMIN"), changeUserRole);

module.exports = router;
