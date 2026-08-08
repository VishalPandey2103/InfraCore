const express = require("express");
const inventoryRoutes = require("./inventoryRoutes");

const router = express.Router();
router.use("/inventory", inventoryRoutes);

module.exports = router;
