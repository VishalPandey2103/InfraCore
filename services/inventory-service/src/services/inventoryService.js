const Item = require("../models/itemModel");
const AppError = require("../utils/appError");

// Owner-or-staff guard: the publisher manages their own item;
// ADMIN and RESOURCE_MANAGER can manage any item.
const assertCanManage = (item, actor) => {
    const isOwner = item.ownerId === actor.id;
    const isStaff = actor.role === "ADMIN" || actor.role === "RESOURCE_MANAGER";
    if (!isOwner && !isStaff) {
        throw new AppError("Forbidden: you do not own this item", 403);
    }
};

const createItem = async (data, ownerId) => {
    const item = await Item.create({ ...data, ownerId });
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
    // "available" means bookable: listed by the owner and not out on loan
    if (filters.available === "true") {
        query.isListed = true;
        query.isOnLoan = false;
    }
    if (filters.available === "false") {
        query.$or = [{ isListed: false }, { isOnLoan: true }];
    }

    return await Item.find(query).sort({ createdAt: -1 });
};

const listMyItems = async (ownerId) => {
    return await Item.find({ ownerId }).sort({ createdAt: -1 });
};

const updateItem = async (id, updates, actor) => {
    const item = await getItemById(id);
    assertCanManage(item, actor);
    item.set(updates);
    await item.save();
    return item;
};

const deleteItem = async (id, actor) => {
    const item = await getItemById(id);
    assertCanManage(item, actor);
    await item.deleteOne();
    return item;
};

// Owner-facing toggle: publish/delist the item.
const setListing = async (id, isListed, actor) => {
    const item = await getItemById(id);
    assertCanManage(item, actor);
    item.isListed = isListed;
    await item.save();
    return item;
};

// Internal (service-to-service) only: lock/unlock the item for a loan.
// No ownership check — the route is guarded by the internal-auth middleware.
const setLoanStatus = async (id, isOnLoan) => {
    const item = await Item.findByIdAndUpdate(
        id,
        { $set: { isOnLoan } },
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
    listMyItems,
    updateItem,
    deleteItem,
    setListing,
    setLoanStatus,
};
