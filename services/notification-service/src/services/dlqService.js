const { getChannel } = require("../config/rabbitmqConfig");
const {
    RABBITMQ_PARKING_QUEUE,
    RABBITMQ_EXCHANGE,
} = require("../config/envConfig");

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
        channel.nack(msg, false, true);
    }
    return messages;
};

const replay = async (limit = 100) => {
    const channel = getChannel();
    if (!channel) throw new Error("channel not ready");

    let replayed = 0;
    for (let i = 0; i < limit; i++) {
        const msg = await channel.get(RABBITMQ_PARKING_QUEUE, { noAck: false });
        if (!msg) break;

        const headers = { ...(msg.properties.headers || {}) };
        const routingKey = headers["x-original-routing-key"] || msg.fields.routingKey;
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

const purge = async () => {
    const channel = getChannel();
    if (!channel) throw new Error("channel not ready");
    const { messageCount } = await channel.purgeQueue(RABBITMQ_PARKING_QUEUE);
    return messageCount;
};

const depth = async () => {
    const channel = getChannel();
    if (!channel) throw new Error("channel not ready");
    const info = await channel.checkQueue(RABBITMQ_PARKING_QUEUE);
    return info.messageCount;
};

module.exports = { peek, replay, purge, depth };
