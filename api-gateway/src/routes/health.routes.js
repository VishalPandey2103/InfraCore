const express = require("express");

const { health } = require("../contoller/health.controller");

const router = express.Router();

router.get("/", health);

module.exports = router;