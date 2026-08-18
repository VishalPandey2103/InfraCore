const { getChannel } = require("../config/rabbitmqConfig");
const {
    RABBITMQ_PARKING_QUEUE,
    RABBITMQ_EXCHANGE,
} = require("../config/envConfig");

// Peek: pull up to `limit` messages off the parking queue WITHOUT acknowledging
// them. We use noAck=false + explicit nack(requeue=true) so operators can look
// at what's parked without draining it. Note this is an approximation — under
// heavy load a message might be re-delivered to another consumer between our
// get and our nack. Good enough for an admin console.
const peek = async (limit = 10) => {
    const channel = getChannel();
    if (!channel) throw new Error("channel not ready");

    const messages = [];
    for (let i = 0; i < limit; i++) {
        const msg = await channel.get(RABBITMQ_PARKING_QUEUE, { noAck: false });
        if (!msg) break;
        try {
            messages.push({
                content: JSON.parse(msg.content.toString()),
                headers: msg.properties.headers,
                originalRoutingKey: msg.fields.routingKey,
            });
        } catch (err) {
            messages.push({
                content: msg.content.toString(),
                parseError: err.message,
                headers: msg.properties.headers,
            });
        }
        // Put it back — peeking must not consume.
        channel.nack(msg, false, true);
    }
    return messages;
};

// Replay: drain the parking queue and re-publish each message to the main
// exchange using its ORIGINAL routing key (stored in x-original-routing-key
// when we parked it). Strips the x-death chain so the retry counter starts
// fresh.
//
// Returns the number of messages replayed.
const replay = async (limit = 100) => {
    const channel = getChannel();
    if (!channel) throw new Error("channel not ready");

    let replayed = 0;
    for (let i = 0; i < limit; i++) {
        const msg = await channel.get(RABBITMQ_PARKING_QUEUE, { noAck: false });
        if (!msg) break;

        const headers = { ...(msg.properties.headers || {}) };
        const routingKey = headers["x-original-routing-key"] || msg.fields.routingKey;
        // Strip retry / parking metadata so the retry counter starts fresh.
        delete headers["x-death"];
        delete headers["x-parking-reason"];
        delete headers["x-parking-time"];
        delete headers["x-original-routing-key"];

        channel.publish(RABBITMQ_EXCHANGE, routingKey, msg.content, {
            persistent: true,
            headers,
        });
        channel.ack(msg);
        replayed++;
    }
    return replayed;
};

// Purge: drop everything in the parking queue. Destructive; requires admin.
const purge = async () => {
    const channel = getChannel();
    if (!channel) throw new Error("channel not ready");
    const { messageCount } = await channel.purgeQueue(RABBITMQ_PARKING_QUEUE);
    return messageCount;
};

// Depth: how many messages are currently parked?
const depth = async () => {
    const channel = getChannel();
    if (!channel) throw new Error("channel not ready");
    // checkQueue is a passive declare — returns the current queue state
    // without changing anything.
    const info = await channel.checkQueue(RABBITMQ_PARKING_QUEUE);
    return info.messageCount;
};

module.exports = { peek, replay, purge, depth };
