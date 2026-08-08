const Item = require("../models/itemModel");
const AppError = require("../utils/appError");

const createItem = async (data, createdBy) => {
    const item = await Item.create({ ...data, createdBy });
    return item;
};

const getItemById = async (id) => {
    const item = await Item.findById(id);
    if (!item) {
        throw new AppError("Item not found", 404);
    }
    return item;
};

const listItems = async (filters = {}) => {
    const query = {};
    if (filters.category) query.category = filters.category;
    if (filters.department) query.department = filters.department;
    if (filters.available === "true") query.isAvailable = true;
    if (filters.available === "false") query.isAvailable = false;

    return await Item.find(query).sort({ createdAt: -1 });
};

const updateItem = async (id, updates) => {
    const item = await Item.findByIdAndUpdate(id, { $set: updates }, { new: true });
    if (!item) {
        throw new AppError("Item not found", 404);
    }
    return item;
};

const deleteItem = async (id) => {
    const item = await Item.findByIdAndDelete(id);
    if (!item) {
        throw new AppError("Item not found", 404);
    }
    return item;
};

const setAvailability = async (id, isAvailable) => {
    const item = await Item.findByIdAndUpdate(
        id,
        { $set: { isAvailable } },
        { new: true }
    );
    if (!item) {
        throw new AppError("Item not found", 404);
    }
    return item;
};

module.exports = {
    createItem,
    getItemById,
    listItems,
    updateItem,
    deleteItem,
    setAvailability,
};
