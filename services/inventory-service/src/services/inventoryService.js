const Item = require("../models/itemModel");
const AppError = require("../utils/appError");
const cache = require("./cacheService");

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
    // A new item can appear in any filtered list — nuke list caches.
    // Owner's "mine" cache is stale too.
    await Promise.all([
        cache.invalidateAllLists(),
        cache.invalidateMine(ownerId),
    ]);
    return item;
};

const getItemById = async (id) => {
    // Cache-aside: check Redis first
    const cached = await cache.getItem(id);
    if (cached) return cached;

    const item = await Item.findById(id);
    if (!item) {
        throw new AppError("Item not found", 404);
    }
    // Populate the cache for the next reader. .toObject() converts the
    // mongoose document into a plain JSON-safe object before caching.
    await cache.setItem(id, item.toObject());
    return item;
};

const listItems = async (filters = {}) => {
    // Only cache the exact filter shape received. Same filters → same key.
    const cached = await cache.getList(filters);
    if (cached) return cached;

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

    const items = await Item.find(query).sort({ createdAt: -1 });
    await cache.setList(filters, items.map((i) => i.toObject()));
    return items;
};

const listMyItems = async (ownerId) => {
    const cached = await cache.getMine(ownerId);
    if (cached) return cached;

    const items = await Item.find({ ownerId }).sort({ createdAt: -1 });
    await cache.setMine(ownerId, items.map((i) => i.toObject()));
    return items;
};

const updateItem = async (id, updates, actor) => {
    const item = await Item.findById(id); // read straight from DB — do NOT use cache
    if (!item) throw new AppError("Item not found", 404);
    assertCanManage(item, actor);
    item.set(updates);
    await item.save();

    // Invalidate every place this item could be cached
    await Promise.all([
        cache.invalidateItem(id),
        cache.invalidateAllLists(),
        cache.invalidateMine(item.ownerId),
    ]);
    return item;
};

const deleteItem = async (id, actor) => {
    const item = await Item.findById(id);
    if (!item) throw new AppError("Item not found", 404);
    assertCanManage(item, actor);
    await item.deleteOne();

    await Promise.all([
        cache.invalidateItem(id),
        cache.invalidateAllLists(),
        cache.invalidateMine(item.ownerId),
    ]);
    return item;
};

// Owner-facing toggle: publish/delist the item.
const setListing = async (id, isListed, actor) => {
    const item = await Item.findById(id);
    if (!item) throw new AppError("Item not found", 404);
    assertCanManage(item, actor);
    item.isListed = isListed;
    await item.save();

    await Promise.all([
        cache.invalidateItem(id),
        cache.invalidateAllLists(),
        cache.invalidateMine(item.ownerId),
    ]);
    return item;
};

// Internal (service-to-service) only: lock/unlock the item for a loan.
// No ownership check — the route is guarded by the internal-auth middleware.
// This is called from the booking service every time a booking is approved
// or returned, so the cache MUST be invalidated to keep availability accurate.
const setLoanStatus = async (id, isOnLoan) => {
    const item = await Item.findByIdAndUpdate(
        id,
        { $set: { isOnLoan } },
        { new: true }
    );
    if (!item) {
        throw new AppError("Item not found", 404);
    }

    await Promise.all([
        cache.invalidateItem(id),
        cache.invalidateAllLists(),
        cache.invalidateMine(item.ownerId),
    ]);
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
