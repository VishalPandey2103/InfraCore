const express = require("express");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
    createItem,
    listItems,
    getItemById,
    updateItem,
    deleteItem,
    setAvailability,
} = require("../controllers/inventoryController");

const router = express.Router();

router.get("/", auth, listItems);
router.get("/:id", auth, getItemById);
router.post("/", auth, role("RESOURCE_MANAGER", "ADMIN"), createItem);
router.patch("/:id", auth, role("RESOURCE_MANAGER", "ADMIN"), updateItem);
router.delete("/:id", auth, role("RESOURCE_MANAGER", "ADMIN"), deleteItem);
router.patch(
    "/:id/availability",
    auth,
    role("RESOURCE_MANAGER", "ADMIN"),
    setAvailability
);

module.exports = router;
