# Notification Service

Pure event consumer. It has no database, no business REST routes, and no clients calling into it. Its entire job is to sit on a RabbitMQ queue, react to booking events, and deliver notifications.

Runs on port **4003** — the HTTP server exists only to expose `/health`.

---

## Role in the system

```
  BOOKING SERVICE
        │  publish
        ▼
  exchange: infracore.events   (topic, durable)
        │  routing key BOOKING_*
        ▼
  queue: notification.bookings (durable)
        │
        ▼
  NOTIFICATION SERVICE
        │
   consumer.js  ──dispatch──▶  handlers/  ──▶  notifierService.send()
```

This service is deliberately decoupled from booking-service. It doesn't know booking-service exists — only that a queue delivers messages in a known shape. Booking-service likewise doesn't know this service exists. Either can be restarted, redeployed, or scaled without touching the other.

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |

Anything else returns a 404. There is no `/api/v1` surface here, and the gateway has no route pointing to this service.

---

## Queue topology

Declared on startup in `src/config/rabbitmqConfig.js`:

| Object | Name | Settings |
|---|---|---|
| Exchange | `infracore.events` | `topic`, `durable: true` |
| Queue | `notification.bookings` | `durable: true` |
| Binding | queue → exchange | routing key `BOOKING_*` |

All three are asserted idempotently, so it doesn't matter whether this service or booking-service starts first.

The `BOOKING_*` wildcard means new booking events are picked up automatically — a new event type needs a handler here, but no broker reconfiguration.

---

## Message handling

`src/events/consumer.js` drives the loop:

```js
channel.consume(RABBITMQ_QUEUE, (msg) => {
    const payload = JSON.parse(msg.content.toString());
    const handler = handlers[payload.eventName];
    ...
});
```

| Situation | Behaviour |
|---|---|
| Handler found | Run it, then `ack` |
| No handler for `eventName` | `console.warn`, then `ack` — an unknown event is not a failure |
| Message fails to parse | `console.error`, then `nack(msg, false, false)` |

The `nack` passes `requeue: false` deliberately. A malformed message will fail identically on every retry, so requeueing it would create an infinite poison-message loop. It's discarded instead.

---

## Events handled

| Event | Handler | Notification |
|---|---|---|
| `BOOKING_CREATED` | `bookingCreatedHandler.js` | "Booking submitted" — pending approval |
| `BOOKING_APPROVED` | `bookingApprovedHandler.js` | "Booking approved" — collect the item |
| `BOOKING_REJECTED` | `bookingRejectedHandler.js` | "Booking rejected" |
| `BOOKING_CANCELLED` | `bookingCancelledHandler.js` | "Booking cancelled" |
| `BOOKING_RETURNED` | `bookingReturnedHandler.js` | "Item returned" — thank you |

`src/handlers/index.js` maps event name → handler using computed keys from `eventNames.js`, so the dispatch table can't drift from the event constants.

Every handler receives the event's `data` payload:

```json
{
    "bookingId": "66b2...",
    "userId": "665a...",
    "itemId": "66b1...",
    "itemName": "Dell Latitude 5420"
}
```

---

## Delivery

In development, "sending" means writing to the console:

```
===== NOTIFICATION =====
Subject: Booking approved: Dell Latitude 5420
Body:    Your booking request for "Dell Latitude 5420" has been approved. You may collect the item.
========================
```

`src/services/notifierService.js` is the single swap point. Replacing `send()` with nodemailer, Twilio, or a push provider requires no change to the consumer or any handler.

Note that the event payload carries `userId`, not an email address — services own their own data. A production implementation would resolve the address by calling user-service, or by having booking-service include contact details in the event.

---

## Environment variables

```
PORT=4003
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_EXCHANGE=infracore.events
RABBITMQ_QUEUE=notification.bookings
```

`RABBITMQ_EXCHANGE` must match the value booking-service publishes to.

---

## Running standalone

```bash
cp .env.example .env
npm install
npm run dev
```

Requires RabbitMQ on port 5672. If the broker is unreachable the process logs the failure and exits with code 1 rather than starting a server that can never receive anything.

Successful startup:

```
RabbitMQ Connected
Consuming events from queue: notification.bookings
Notification Service running on port 4003
```

---

## Verifying it works

1. Open the management UI at http://localhost:15672 (`guest` / `guest`).
2. Find the `notification.bookings` queue and confirm it's bound to `infracore.events` with routing key `BOOKING_*`.
3. Create a booking through the gateway and watch the console here.

To see durability in action, stop this service, run a booking through, and watch the queue depth climb in the UI. Start it again — the backlog drains immediately. No events are lost while the consumer is down.
