const { getChannel } = require("../config/rabbitmqConfig");
const { RABBITMQ_EXCHANGE } = require("../config/envConfig");

const publish = (eventName, data) => {
    const channel = getChannel();
    if (!channel) {
        console.error("Cannot publish: RabbitMQ channel not ready");
        return;
    }

    const payload = {
        eventName,
        timestamp: new Date().toISOString(),
        data,
    };

    channel.publish(
        RABBITMQ_EXCHANGE,
        eventName,
        Buffer.from(JSON.stringify(payload)),
        { persistent: true }
    );

    console.log(`Published event: ${eventName}`);
};

module.exports = { publish };
