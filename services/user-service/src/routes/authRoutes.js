const express = require("express");
const auth = require("../middlewares/authMiddleware");
const { register, login, logout } = require("../controllers/authController");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
// Logout is authenticated so the gateway populates x-user-id / x-user-jti / x-user-exp
router.post("/logout", auth, logout);

module.exports = router;
