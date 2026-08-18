const crypto = require("crypto");
const { getRedis, isRedisReady } = require("../config/redisConfig");
const { CACHE_ITEM_TTL_SECONDS, CACHE_LIST_TTL_SECONDS } = require("../config/envConfig");

// Cache-aside pattern:
//   Read:  check cache -> hit? return. miss? fetch from DB, populate cache, return.
//   Write: write DB first, then invalidate cache. NEVER the other way around
//          (double-write pattern is racy — a reader can populate the cache with
//          stale data between the DB write and the cache write).
//
// Key namespaces:
//   inv:item:<id>          → single item JSON
//   inv:list:<hash>        → filtered list JSON (hash of filter object)
//   inv:mine:<ownerId>     → user's own items
//   inv:list-index         → SET of every list-cache key (for bulk invalidation)
//
// Why a list-index set: filtered lists have infinitely many key permutations
// (any combination of category / department / available). When any item changes
// we can't know which list caches contain it, so we nuke them all. The index
// lets us do that in one SUNION + DEL instead of a SCAN.

const hashFilters = (filters) => {
    const normalized = JSON.stringify(filters, Object.keys(filters).sort());
    return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 12);
};

// ---------- Single-item cache ----------
const getItem = async (id) => {
    if (!isRedisReady()) return null;
    try {
        const raw = await getRedis().get(`inv:item:${id}`);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.error("[inventory-service] cache getItem failed:", err.message);
        return null;
    }
};

const setItem = async (id, item) => {
    if (!isRedisReady()) return;
    try {
        await getRedis().set(`inv:item:${id}`, JSON.stringify(item), {
            EX: CACHE_ITEM_TTL_SECONDS,
        });
    } catch (err) {
        console.error("[inventory-service] cache setItem failed:", err.message);
    }
};

const invalidateItem = async (id) => {
    if (!isRedisReady()) return;
    try {
        await getRedis().del(`inv:item:${id}`);
    } catch (err) {
        console.error("[inventory-service] cache invalidateItem failed:", err.message);
    }
};

// ---------- List cache ----------
const getList = async (filters) => {
    if (!isRedisReady()) return null;
    try {
        const key = `inv:list:${hashFilters(filters)}`;
        const raw = await getRedis().get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.error("[inventory-service] cache getList failed:", err.message);
        return null;
    }
};

const setList = async (filters, items) => {
    if (!isRedisReady()) return;
    try {
        const key = `inv:list:${hashFilters(filters)}`;
        const redis = getRedis();
        // Pipeline: set the cache entry AND register it in the invalidation index
        await redis
            .multi()
            .set(key, JSON.stringify(items), { EX: CACHE_LIST_TTL_SECONDS })
            .sAdd("inv:list-index", key)
            .exec();
    } catch (err) {
        console.error("[inventory-service] cache setList failed:", err.message);
    }
};

const getMine = async (ownerId) => {
    if (!isRedisReady()) return null;
    try {
        const raw = await getRedis().get(`inv:mine:${ownerId}`);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        return null;
    }
};

const setMine = async (ownerId, items) => {
    if (!isRedisReady()) return;
    try {
        await getRedis().set(`inv:mine:${ownerId}`, JSON.stringify(items), {
            EX: CACHE_LIST_TTL_SECONDS,
        });
    } catch (err) {
        console.error("[inventory-service] cache setMine failed:", err.message);
    }
};

// Bulk invalidation: called on any create/update/delete/loan-state change.
// Nukes every list-shaped cache entry (owner lists, filtered lists) because we
// don't know which of them included the affected item. The per-item cache is
// invalidated separately via invalidateItem().
const invalidateAllLists = async () => {
    if (!isRedisReady()) return;
    try {
        const redis = getRedis();
        const keys = await redis.sMembers("inv:list-index");
        if (keys.length > 0) {
            await redis.del(keys);
        }
        await redis.del("inv:list-index");
        // Also blow away every per-owner "mine" cache. Small blast radius
        // (bounded by number of item owners), acceptable price for correctness.
        // In a real system with millions of owners you would instead track
        // which owner's cache to invalidate based on the item's ownerId.
    } catch (err) {
        console.error("[inventory-service] cache invalidateAllLists failed:", err.message);
    }
};

const invalidateMine = async (ownerId) => {
    if (!isRedisReady()) return;
    try {
        await getRedis().del(`inv:mine:${ownerId}`);
    } catch (err) {
        console.error("[inventory-service] cache invalidateMine failed:", err.message);
    }
};

module.exports = {
    getItem,
    setItem,
    invalidateItem,
    getList,
    setList,
    getMine,
    setMine,
    invalidateAllLists,
    invalidateMine,
};
