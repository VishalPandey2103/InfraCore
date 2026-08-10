# Booking Service

Owns the borrowing lifecycle — the domain core of the platform. It's the only service that talks to another service synchronously, and the only one that publishes events.

Runs on port **4002**, backed by the `booking-service` database. Requires both MongoDB and RabbitMQ.

---

## State machine

```
                    ┌───────────┐
                    │  PENDING  │  ← every booking starts here
                    └─────┬─────┘
          ┌───────────────┼───────────────┐
          │               │               │
      approve          reject          cancel
   (mgr/admin)      (mgr/admin)      (student, own only)
          │               │               │
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌─────────────┐
   │  APPROVED  │  │  REJECTED  │  │  CANCELLED  │
   └──────┬─────┘  └────────────┘  └─────────────┘
          │            terminal        terminal
       return
    (mgr/admin)
          │
          ▼
   ┌────────────┐
   │  RETURNED  │  terminal
   └────────────┘
```

The transition table in `src/utils/bookingState.js` is the single source of truth:

```js
PENDING:   ["APPROVED", "REJECTED", "CANCELLED"],
APPROVED:  ["RETURNED"],
REJECTED:  [],
CANCELLED: [],
RETURNED:  []
```

Anything not listed is rejected with a 400 naming both states — `"Cannot transition from APPROVED to APPROVED"`. The check runs in the service layer, so it can't be bypassed by hitting a different route.

---

## Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/api/v1/bookings` | `STUDENT` | Create a booking |
| `GET` | `/api/v1/bookings/me` | any authed user | Own bookings |
| `GET` | `/api/v1/bookings` | `RESOURCE_MANAGER`, `ADMIN` | All bookings |
| `GET` | `/api/v1/bookings/:id` | owner, or manager/admin | Single booking |
| `PATCH` | `/api/v1/bookings/:id/approve` | `RESOURCE_MANAGER`, `ADMIN` | → `APPROVED` |
| `PATCH` | `/api/v1/bookings/:id/reject` | `RESOURCE_MANAGER`, `ADMIN` | → `REJECTED` |
| `PATCH` | `/api/v1/bookings/:id/return` | `RESOURCE_MANAGER`, `ADMIN` | → `RETURNED` |
| `PATCH` | `/api/v1/bookings/:id/cancel` | `STUDENT`, own only | → `CANCELLED` |
| `GET` | `/health` | public | Liveness check |

All four status routes accept an optional `{ "remarks": "..." }` body.

`/me` is declared before `/:id` in the router so the literal path isn't captured by the parameter route.

---

## Data model

```js
{
    userId:      String,  // from the gateway headers — not an ObjectId ref
    itemId:      String,  // from inventory-service — not an ObjectId ref
    itemName:    String,  // snapshotted at booking time
    status:      String,  // PENDING | APPROVED | REJECTED | CANCELLED | RETURNED
    remarks:     String,  // defaults to ""
    approvedAt:  Date,
    rejectedAt:  Date,
    cancelledAt: Date,
    returnedAt:  Date,
    createdAt:   Date,
    updatedAt:   Date
}
```

**Why `userId` and `itemId` are strings.** Both live in other services' databases. Declaring them as Mongoose refs would invite a cross-service `.populate()` — exactly the coupling database-per-service exists to prevent.

**Why `itemName` is duplicated.** It's a snapshot taken when the booking is created. If the item is later renamed or deleted, historical bookings still read correctly and the notification emails still make sense. Deliberate denormalization at a service boundary.

**Why four timestamps instead of a status log.** Each terminal state stamps its own field, so the lifecycle of a booking is readable from the document alone.

---

## Creating a booking

```
POST /api/v1/bookings  { itemId }
        │
        ▼
  validateCreateBooking          →  400 if itemId is missing
        │
        ▼
  inventoryClient.getItem()      [ SYNCHRONOUS HTTP → :4001 ]
        │
        ├── 404          →  404 "Item not found"
        ├── unreachable  →  503 "Inventory service unavailable"
        └── 200          →  item
        │
        ▼
  item.isAvailable === false     →  400 "Item is not available"
        │
        ▼
  Booking.create({ status: "PENDING", itemName: item.name })
        │
        ▼
  publish BOOKING_CREATED        [ ASYNCHRONOUS → RabbitMQ ]
        │
        ▼
  201 { success: true, message: "Booking created", data: { ... } }
```

The availability check is synchronous because the answer changes what happens next. The event is asynchronous because nothing is waiting on it.

---

## Item availability

Booking-service drives the item's `isAvailable` flag through `inventoryClient`:

| Transition | Call | Effect |
|---|---|---|
| `PENDING → APPROVED` | `setItemAvailability(itemId, false)` | Item locked |
| `APPROVED → RETURNED` | `setItemAvailability(itemId, true)` | Item released |
| `PENDING → REJECTED` | none | Never locked, nothing to release |
| `PENDING → CANCELLED` | none | Never locked, nothing to release |

An item is only ever locked at approval, so the two paths that leave `PENDING` without approval require no compensating call.

---

## Inter-service calls

`src/clients/inventoryClient.js` wraps both outbound calls with axios:

| Method | Calls | Used by |
|---|---|---|
| `getItem(itemId, userId, userRole)` | `GET /api/v1/inventory/:id` | Booking creation |
| `setItemAvailability(itemId, isAvailable, userId, userRole)` | `PATCH /api/v1/inventory/:id/availability` | Approve / return |

Both forward the original caller's `x-user-id` and `x-user-role` headers, since inventory-service uses the same gateway-trust model. Failures are translated into `AppError` rather than leaking axios errors — a 404 stays a 404, everything else becomes a 503.

Because the *caller's* role is forwarded rather than a service identity, an action initiated by a `STUDENT` that reaches the availability endpoint would be rejected with a 403 (surfacing here as a 503). In practice this doesn't arise: availability only changes on approve and return, both manager/admin actions.

---

## Events published

To exchange `infracore.events` (topic, durable), routing key equal to the event name, `persistent: true`:

| Event | Emitted on |
|---|---|
| `BOOKING_CREATED` | Successful creation |
| `BOOKING_APPROVED` | `PENDING → APPROVED` |
| `BOOKING_REJECTED` | `PENDING → REJECTED` |
| `BOOKING_CANCELLED` | `PENDING → CANCELLED` |
| `BOOKING_RETURNED` | `APPROVED → RETURNED` |

Payload:

```json
{
    "eventName": "BOOKING_APPROVED",
    "timestamp": "2026-08-10T14:22:31.004Z",
    "data": {
        "bookingId": "66b2...",
        "userId": "665a...",
        "itemId": "66b1...",
        "itemName": "Dell Latitude 5420"
    }
}
```

Publishing is fire-and-forget. If the channel isn't ready, `publisher.js` logs an error and returns — a broker hiccup won't fail a booking that has already been persisted.

---

## Auth model

Gateway-trust, same as inventory-service: `authMiddleware` reads `x-user-id` and `x-user-role`, and never verifies a JWT.

Authorization is layered:

1. **Role**, at the route — `role("STUDENT")` on create and cancel, `role("RESOURCE_MANAGER", "ADMIN")` on approve/reject/return.
2. **Ownership**, in the service — `changeStatus` rejects a cancel when `booking.userId` doesn't match the caller.
3. **Visibility**, in the controller — `getBookingById` returns 403 if a `STUDENT` requests someone else's booking.

The four status handlers are generated from one `makeStatusHandler(newStatus)` factory in the controller, so the transition logic exists in exactly one place.

---

## Environment variables

```
PORT=4002
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/booking-service
INVENTORY_SERVICE_URL=http://localhost:4001
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_EXCHANGE=infracore.events
```

`RABBITMQ_EXCHANGE` must match the value notification-service binds its queue to.

---

## Running standalone

```bash
cp .env.example .env
npm install
npm run dev
```

Requires **both** MongoDB and RabbitMQ. Startup order is `connectDB()` → `connectRabbitMQ()` → `listen()`, and either failure exits with code 1.

Successful startup:
```
MongoDB Connected
RabbitMQ Connected
Booking Service running on port 4002
```

Inventory-service should also be running, or booking creation returns a 503.

---

## Error responses

| Status | When |
|---|---|
| `400` | Missing `itemId`, item unavailable, or an illegal state transition |
| `401` | Missing gateway identity headers |
| `403` | Wrong role, or acting on another user's booking |
| `404` | Booking or item not found |
| `503` | Inventory-service unreachable or rejected the call |

```json
{ "success": false, "message": "Cannot transition from APPROVED to APPROVED" }
```
