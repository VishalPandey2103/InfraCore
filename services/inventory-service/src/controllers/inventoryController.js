const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const AppError = require("../utils/appError");
const inventoryService = require("../services/inventoryService");
const { validateCreateItem, validateUpdateItem } = require("../validators/inventoryValidator");

const createItem = asyncHandler(async (req, res) => {
    const { valid, errors } = validateCreateItem(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }
    const item = await inventoryService.createItem(req.body, req.user.id);
    res.status(201).json(new ApiResponse(true, "Item created", item));
});

const listItems = asyncHandler(async (req, res) => {
    const items = await inventoryService.listItems(req.query);
    res.json(new ApiResponse(true, "Items fetched", items));
});

const listMyItems = asyncHandler(async (req, res) => {
    const items = await inventoryService.listMyItems(req.user.id);
    res.json(new ApiResponse(true, "Items fetched", items));
});

const getItemById = asyncHandler(async (req, res) => {
    const item = await inventoryService.getItemById(req.params.id);
    res.json(new ApiResponse(true, "Item fetched", item));
});

const updateItem = asyncHandler(async (req, res) => {
    const { valid, errors, updates } = validateUpdateItem(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }
    const item = await inventoryService.updateItem(req.params.id, updates, req.user);
    res.json(new ApiResponse(true, "Item updated", item));
});

const deleteItem = asyncHandler(async (req, res) => {
    await inventoryService.deleteItem(req.params.id, req.user);
    res.json(new ApiResponse(true, "Item deleted"));
});

// Owner-facing: publish/delist the item.
const setListing = asyncHandler(async (req, res) => {
    const { isListed } = req.body;
    if (typeof isListed !== "boolean") {
        throw new AppError("isListed must be boolean", 400);
    }
    const item = await inventoryService.setListing(req.params.id, isListed, req.user);
    res.json(new ApiResponse(true, "Listing updated", item));
});

// Internal only: booking-service locks/unlocks the item around a loan.
const setLoanStatus = asyncHandler(async (req, res) => {
    const { isOnLoan } = req.body;
    if (typeof isOnLoan !== "boolean") {
        throw new AppError("isOnLoan must be boolean", 400);
    }
    const item = await inventoryService.setLoanStatus(req.params.id, isOnLoan);
    res.json(new ApiResponse(true, "Loan status updated", item));
});

module.exports = {
    createItem,
    listItems,
    listMyItems,
    getItemById,
    updateItem,
    deleteItem,
    setListing,
    setLoanStatus,
};
