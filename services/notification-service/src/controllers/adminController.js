const dlq = require("../services/dlqService");

const parkingDepth = async (req, res, next) => {
    try {
        const count = await dlq.depth();
        res.json({ success: true, data: { messageCount: count } });
    } catch (err) {
        next(err);
    }
};

const parkingPeek = async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
        const messages = await dlq.peek(limit);
        res.json({ success: true, data: messages });
    } catch (err) {
        next(err);
    }
};

const parkingReplay = async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.body.limit || "100", 10), 500);
        const replayed = await dlq.replay(limit);
        res.json({ success: true, data: { replayed } });
    } catch (err) {
        next(err);
    }
};

const parkingPurge = async (req, res, next) => {
    try {
        const purged = await dlq.purge();
        res.json({ success: true, data: { purged } });
    } catch (err) {
        next(err);
    }
};

module.exports = { parkingDepth, parkingPeek, parkingReplay, parkingPurge };
