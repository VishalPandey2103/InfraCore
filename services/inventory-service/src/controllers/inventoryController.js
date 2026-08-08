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

const getItemById = asyncHandler(async (req, res) => {
    const item = await inventoryService.getItemById(req.params.id);
    res.json(new ApiResponse(true, "Item fetched", item));
});

const updateItem = asyncHandler(async (req, res) => {
    const { valid, errors } = validateUpdateItem(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }
    const item = await inventoryService.updateItem(req.params.id, req.body);
    res.json(new ApiResponse(true, "Item updated", item));
});

const deleteItem = asyncHandler(async (req, res) => {
    await inventoryService.deleteItem(req.params.id);
    res.json(new ApiResponse(true, "Item deleted"));
});

const setAvailability = asyncHandler(async (req, res) => {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== "boolean") {
        throw new AppError("isAvailable must be boolean", 400);
    }
    const item = await inventoryService.setAvailability(req.params.id, isAvailable);
    res.json(new ApiResponse(true, "Availability updated", item));
});

module.exports = {
    createItem,
    listItems,
    getItemById,
    updateItem,
    deleteItem,
    setAvailability,
};
