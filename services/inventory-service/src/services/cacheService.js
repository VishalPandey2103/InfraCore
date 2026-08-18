const { getRedis, isRedisReady } = require("../config/redisConfig");
const { CACHE_ITEM_TTL_SECONDS } = require("../config/envConfig");

// Cache-aside pattern:
//   Read:  check cache -> hit? return. miss? fetch from DB, populate cache, return.
//   Write: write DB first, then invalidate cache. NEVER the other way around
//          (double-write pattern is racy — a reader can populate the cache with
//          stale data between the DB write and the cache write).
//
// Key namespaces:
//   inv:item:<id>          → single item JSON

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

module.exports = {
    getItem,
    setItem,
    invalidateItem,
};
