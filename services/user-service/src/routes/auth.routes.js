const express = require("express");

const {health, register} = require("../controllers/auth.controller");

const router = express.Router();

router.get("/health", health);

router.post("/register", register);

module.exports = router;