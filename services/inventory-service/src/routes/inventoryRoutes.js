const express = require("express");
const auth = require("../middlewares/authMiddleware");
const internalAuth = require("../middlewares/internalAuthMiddleware");
const {
    createItem,
    listItems,
    listMyItems,
    getItemById,
    updateItem,
    deleteItem,
    setListing,
    setLoanStatus,
} = require("../controllers/inventoryController");

const router = express.Router();

// Internal (service-to-service) — no user auth, shared-secret only.
router.patch("/:id/loan", internalAuth, setLoanStatus);

// Any authenticated user can publish and browse items.
// Ownership checks (owner / RESOURCE_MANAGER / ADMIN) live in the service layer.
router.get("/", auth, listItems);
router.get("/mine", auth, listMyItems);
router.get("/:id", auth, getItemById);
router.post("/", auth, createItem);
router.patch("/:id", auth, updateItem);
router.delete("/:id", auth, deleteItem);
router.patch("/:id/availability", auth, setListing);

module.exports = router;
