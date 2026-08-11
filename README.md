# InfraCore

A distributed microservices platform for managing shared organizational assets — laptops, projectors, lab equipment, cameras, and other institutional resources. Built as an event-driven system with hard service boundaries, database-per-service isolation, edge authentication, and both synchronous and asynchronous inter-service communication.

The domain is a university asset-borrowing system, but the architecture is domain-agnostic.

---

## Table of contents

- [Architecture](#architecture)
- [Request flow](#request-flow)
- [Event flow](#event-flow)
- [Services](#services)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Testing](#testing)
- [Roles and permissions](#roles-and-permissions)
- [Booking state machine](#booking-state-machine)
- [Events](#events)
- [Response format](#response-format)
- [Project layout](#project-layout)
- [Design decisions](#design-decisions)
- [Troubleshooting](#troubleshooting)

---

## Architecture

Five Node processes. One public entry point. Three private databases. One message broker.

```
                            ┌──────────────┐
                            │    Client    │
                            └──────┬───────┘
                                   │  Authorization: Bearer <JWT>
                                   ▼
              ┌────────────────────────────────────────────┐
              │            API GATEWAY  :3000              │
              │                                            │
              │  1. verify JWT   (skipped for /auth/*)     │
              │  2. decode -> req.user = { id, role }      │
              │  3. inject  x-user-id / x-user-role        │
              │  4. strip   Authorization header           │
              │  5. restore path, then proxy by prefix     │
              └───┬──────────────┬───────────────┬─────────┘
                  │              │               │
   /api/v1/auth   │              │ /api/v1/      │ /api/v1/
   /api/v1/users  │              │ inventory     │ bookings
                  ▼              ▼               ▼
        ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
        │  USER SERVICE   │ │  INVENTORY   │ │  BOOKING         │
        │      :4000      │ │   SERVICE    │ │  SERVICE         │
        │                 │ │    :4001     │ │    :4002         │
        │ register/login  │ │ item catalog │ │ state machine    │
        │ JWT issuing     │ │ availability │ │ owns lifecycle   │
        │ profiles / RBAC │ │              │ │                  │
        └────────┬────────┘ └──────┬───────┘ └───┬──────────┬───┘
                 │                 │   ▲         │          │
                 │                 │   │  HTTP   │          │
                 │                 │   └─────────┘          │
                 │                 │  check availability    │ publish
                 │                 │  lock / release item   │ events
                 ▼                 ▼                        ▼
        ┌────────────────┐ ┌────────────────┐   ┌───────────────────────┐
        │  MongoDB Atlas │ │  MongoDB Atlas │   │       RabbitMQ        │
        │  user-service  │ │   inventory-   │   │  exchange:            │
        │                │ │    service     │   │  infracore.events     │
        └────────────────┘ └────────────────┘   │  type: topic, durable │
                                                └───────────┬───────────┘
        ┌────────────────┐                                  │ routing key
        │  MongoDB Atlas │◀────── booking-service           │ one per event
        │ booking-service│                                  ▼
        └────────────────┘                   ┌──────────────────────────┐
                                             │   queue:                 │
                                             │   notification.bookings  │
                                             │   (durable)              │
                                             └────────────┬─────────────┘
                                                          ▼
                                             ┌──────────────────────────┐
                                             │  NOTIFICATION SERVICE    │
                                             │           :4003          │
                                             │  pure consumer, no DB    │
                                             │  no business REST routes │
                                             └──────────────────────────┘
```

**Two communication styles, used deliberately:**

| Style | Where | Why |
|---|---|---|
| **Synchronous HTTP** | Booking → Inventory | The caller needs an answer *now* — is this item available? — before it can decide whether to create the booking. |
| **Asynchronous events** | Booking → RabbitMQ → Notification | Nobody is waiting on a notification. Sending it must not slow down, or be able to fail, the booking request. |

---

## Request flow

A full trace of `POST /api/v1/bookings` — the most involved path in the system.

```
 1. Client
      POST http://localhost:3000/api/v1/bookings
      Authorization: Bearer eyJhbGci...
      { "itemId": "66b2f1a9c3e4d5f6a7b8c9d0" }
                │
                ▼
 2. API Gateway  (jwtMiddleware)
      • prefix /api/v1/bookings is marked public: false  →  JWT required
      • jwt.verify(token, JWT_SECRET)
      • req.user = { id: "665a...", role: "STUDENT" }
                │
                ▼
 3. API Gateway  (proxyReq hook)
      • sets  x-user-id:   665a...
      • sets  x-user-role: STUDENT
      • removes Authorization           ← raw JWT never leaves the edge
      • pathRewrite restores the prefix Express stripped
      • forwards to http://localhost:4002/api/v1/bookings
                │
                ▼
 4. Booking Service  (authMiddleware — gateway trust)
      • reads x-user-id / x-user-role
      • does NOT verify the JWT (only the gateway does)
      • req.user = { id, role }
                │
                ▼
 5. Booking Service  (roleMiddleware)
      • route requires role("STUDENT")  →  403 otherwise
                │
                ▼
 6. Booking Service  (controller)
      • validateCreateBooking(req.body)  →  400 if itemId missing
      • delegates to bookingService.createBooking(...)
                │
                ▼
 7. Booking Service  →  Inventory Service        [ SYNCHRONOUS ]
      GET http://localhost:4001/api/v1/inventory/:id
      x-user-id / x-user-role forwarded from the original caller
                │
                ├─ 404      →  AppError("Item not found", 404)
                ├─ down     →  AppError("Inventory service unavailable", 503)
                └─ 200      →  item
                │
                ▼
 8. Booking Service  (domain rule)
      • item.isAvailable === false  →  AppError("Item is not available", 400)
      • otherwise persist Booking { status: "PENDING", itemName: <snapshot> }
                │
                ▼
 9. Booking Service  →  RabbitMQ                 [ ASYNCHRONOUS ]
      publish BOOKING_CREATED to exchange infracore.events
      routing key = BOOKING_CREATED, persistent
                │
                ▼
10. Response travels back  →  gateway  →  client
      201 { success: true, message: "Booking created", data: { ...booking } }

      ── meanwhile, independently ──
                │
                ▼
11. Notification Service
      • queue notification.bookings receives the message
      • consumer dispatches on payload.eventName
      • bookingCreatedHandler → notifier.send(...) → console
      • channel.ack(msg)
```

The booking response does **not** wait on step 11. If notification-service is offline, the booking still succeeds and the durable queue holds the event until it comes back.

---

## Event flow

```
                        BOOKING SERVICE
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   createBooking        changeStatus           changeStatus
        │                     │                     │
        ▼                     ▼                     ▼
 BOOKING_CREATED      BOOKING_APPROVED      BOOKING_REJECTED
                      BOOKING_RETURNED      BOOKING_CANCELLED
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
              exchange: infracore.events  (topic, durable)
                              │
              bindings: one per event name
                              │
                              ▼
              queue: notification.bookings  (durable)
                              │
                              ▼
                    NOTIFICATION SERVICE
                       consumer.js
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        handler found   no handler       parse error
              │               │               │
         handler(data)   console.warn    console.error
              │               │               │
            ack()           ack()      nack(requeue: false)
                                          (discard)
```

Every message carries the same envelope:

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

The exchange is a **topic** exchange, so adding a second consumer later — an audit service, an analytics sink — is a matter of binding a new queue to the same routing keys. No producer change required.

> **A trap worth knowing.** Topic-exchange wildcards match whole *dot-delimited words*. A binding of `BOOKING_*` does **not** match the routing key `BOOKING_CREATED`, because `*` is only a wildcard when it stands alone as a word — `BOOKING_*` is just one literal word. The queue was originally bound that way, and every message was silently discarded: booking-service logged `Published event: BOOKING_CREATED`, the queue stayed at zero, and nothing errored anywhere.
>
> The fix was to bind each event name explicitly. The alternative is dotted routing keys (`booking.created`, bound as `booking.*`), which is the idiomatic AMQP shape and what you'd reach for with more event types.

---

## Services

| Service | Port | Database | Owns | Auth model |
|---|---|---|---|---|
| [API Gateway](api-gateway/) | 3000 | — | Routing, JWT verification, header injection | Verifies JWT |
| [User Service](services/user-service/) | 4000 | `user-service` | Identity, auth, profiles, roles | Trusts gateway headers (signs tokens) |
| [Inventory Service](services/inventory-service/) | 4001 | `inventory-service` | Item catalog, availability | Trusts gateway headers |
| [Booking Service](services/booking-service/) | 4002 | `booking-service` | Booking lifecycle, event publishing | Trusts gateway headers |
| [Notification Service](services/notification-service/) | 4003 | — | Consuming events, sending notifications | None (no business routes) |

Each service has its own README with endpoint-level detail.

---

## Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 18+ |
| HTTP | Express 4 |
| Database | MongoDB Atlas + Mongoose 8 — one database per service |
| Message broker | RabbitMQ (amqplib), topic exchange |
| Auth | jsonwebtoken (HS256) + bcryptjs |
| Validation | `validator` + hand-rolled validators returning `{ valid, errors }` |
| Gateway proxy | http-proxy-middleware 3 |
| Inter-service HTTP | axios |
| Dev orchestration | concurrently |
| Module system | CommonJS (`require` / `module.exports`) |

No TypeScript, no Docker, no shared library between services — all deliberate. See [Design decisions](#design-decisions).

---

## Prerequisites

- **Node.js 18+**
- **MongoDB Atlas** cluster (free tier is fine) with three databases: `user-service`, `inventory-service`, `booking-service`
- **RabbitMQ** running locally on port 5672

### Installing RabbitMQ

**macOS**
```bash
brew install rabbitmq && brew services start rabbitmq
```

**Ubuntu / WSL**
```bash
sudo apt install rabbitmq-server && sudo systemctl start rabbitmq-server
```

**Windows** — download the installer from https://www.rabbitmq.com/download.html

Enable the management UI (strongly recommended — you can watch events flow):
```bash
rabbitmq-plugins enable rabbitmq_management
```
Then open http://localhost:15672 (default credentials `guest` / `guest`).

---

## Setup

**1. Install every service's dependencies in one command**
```bash
npm run install:all
```

**2. Create the five `.env` files**

Each service reads its own `.env` from its own folder. Copy each `.env.example` next to it:

```bash
cp api-gateway/.env.example                      api-gateway/.env
cp services/user-service/.env.example            services/user-service/.env
cp services/inventory-service/.env.example       services/inventory-service/.env
cp services/booking-service/.env.example         services/booking-service/.env
cp services/notification-service/.env.example    services/notification-service/.env
```

Fill in your Atlas URIs (note the database name at the end of each URI differs per service) and a JWT secret.

Generate a strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **`JWT_SECRET` must be byte-identical in `api-gateway/.env` and `services/user-service/.env`.**
> User-service signs the token; the gateway verifies it. A mismatch means every authenticated request 401s at the edge.

**3. Run everything**
```bash
npm run dev
```

All five processes start in parallel with colour-coded, prefixed logs:

```
[user]         MongoDB Connected
[user]         User Service running on port 4000
[inventory]    MongoDB Connected
[inventory]    Inventory Service running on port 4001
[booking]      MongoDB Connected
[booking]      RabbitMQ Connected
[booking]      Booking Service running on port 4002
[notification] RabbitMQ Connected
[notification] Consuming events from queue: notification.bookings
[notification] Notification Service running on port 4003
[gateway]      API Gateway running on port 3000
```

To run a single service instead:
```bash
npm --prefix services/user-service run dev
```

---

## Environment variables

Every variable is read exactly once, in that service's `src/config/envConfig.js`, and re-exported. No module anywhere reads `process.env` directly.

| Service | Variables |
|---|---|
| `api-gateway` | `PORT`, `JWT_SECRET`, `USER_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `BOOKING_SERVICE_URL` |
| `user-service` | `PORT`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN` |
| `inventory-service` | `PORT`, `MONGODB_URI` |
| `booking-service` | `PORT`, `MONGODB_URI`, `INVENTORY_SERVICE_URL`, `RABBITMQ_URL`, `RABBITMQ_EXCHANGE` |
| `notification-service` | `PORT`, `RABBITMQ_URL`, `RABBITMQ_EXCHANGE`, `RABBITMQ_QUEUE` |

The root [`.env.example`](.env.example) documents all of them in one place for reference. The root itself reads no env vars.

---

## API reference

Everything below goes through the gateway on port 3000.

### Auth — public

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/auth/register` | `{ name, email, password }` |
| `POST` | `/api/v1/auth/login` | `{ email, password }` |

### Users

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/v1/users/me` | any authenticated user |
| `PATCH` | `/api/v1/users/me` | self |
| `GET` | `/api/v1/users` | `ADMIN` |
| `GET` | `/api/v1/users/:id` | self or `ADMIN` |
| `PATCH` | `/api/v1/users/:id/role` | `ADMIN` |

### Inventory

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/v1/inventory` | any authenticated user |
| `GET` | `/api/v1/inventory/:id` | any authenticated user |
| `POST` | `/api/v1/inventory` | `RESOURCE_MANAGER`, `ADMIN` |
| `PATCH` | `/api/v1/inventory/:id` | `RESOURCE_MANAGER`, `ADMIN` |
| `DELETE` | `/api/v1/inventory/:id` | `RESOURCE_MANAGER`, `ADMIN` |
| `PATCH` | `/api/v1/inventory/:id/availability` | `RESOURCE_MANAGER`, `ADMIN` |

Filters on the list endpoint: `?category=`, `?department=`, `?available=true|false`

### Bookings

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/v1/bookings` | `STUDENT` |
| `GET` | `/api/v1/bookings/me` | any authenticated user |
| `GET` | `/api/v1/bookings` | `RESOURCE_MANAGER`, `ADMIN` |
| `GET` | `/api/v1/bookings/:id` | owner or `RESOURCE_MANAGER`/`ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/approve` | `RESOURCE_MANAGER`, `ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/reject` | `RESOURCE_MANAGER`, `ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/return` | `RESOURCE_MANAGER`, `ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/cancel` | `STUDENT` (own bookings only) |

### Health

Each process exposes an unauthenticated `GET /health`: ports 3000, 4000, 4001, 4002, 4003.

---

## Walkthrough

A complete run through the system.

```bash
# 1. Register a student
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Vishal","email":"vishal@test.com","password":"password123"}'

# 2. Log in and keep the token
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"vishal@test.com","password":"password123"}'

export STUDENT_TOKEN="<token from the response>"
```

Promote a second account to `RESOURCE_MANAGER` (see [Roles](#roles-and-permissions) for how to create the first one), log in as them, and keep that token as `MANAGER_TOKEN`.

```bash
# 3. Manager adds an item to the catalog
curl -X POST http://localhost:3000/api/v1/inventory \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dell Latitude 5420","category":"Laptop","department":"CSE"}'

# 4. Student browses what is available
curl "http://localhost:3000/api/v1/inventory?available=true" \
  -H "Authorization: Bearer $STUDENT_TOKEN"

# 5. Student books it  →  BOOKING_CREATED fires
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"<item id from step 4>"}'

# 6. Manager approves  →  BOOKING_APPROVED fires, item locked
curl -X PATCH http://localhost:3000/api/v1/bookings/<bookingId>/approve \
  -H "Authorization: Bearer $MANAGER_TOKEN"

# 7. Manager marks it returned  →  BOOKING_RETURNED fires, item released
curl -X PATCH http://localhost:3000/api/v1/bookings/<bookingId>/return \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

Watch the `[notification]` lane in your terminal — three `===== NOTIFICATION =====` blocks appear, one per event.

Try approving twice to see the state machine reject it:
```
400 { "success": false, "message": "Cannot transition from APPROVED to APPROVED" }
```

---

## Testing

A Postman collection covering every endpoint lives in [`tests/`](tests/), along with a step-by-step walkthrough in [tests/README.md](tests/README.md).

```bash
node tests/scripts/bootstrap-admin.js     # create the first ADMIN
node tests/scripts/reset-test-data.js --yes   # wipe test data, keep the admin
```

Import both files from `tests/postman/` and select the **InfraCore - Local** environment. Login stores the token automatically; every other request reuses it.

There are no automated unit or integration tests yet.

---

## Roles and permissions

Three roles, stored on the User document and embedded in the JWT payload:

| Role | Can do |
|---|---|
| `STUDENT` | Browse inventory, create bookings, cancel own bookings, view own bookings |
| `RESOURCE_MANAGER` | Everything above, plus manage the item catalog and approve/reject/return any booking |
| `ADMIN` | Everything above, plus list all users and change any user's role |

`STUDENT` is the default assigned at registration — the register endpoint hard-codes it, so the role cannot be escalated through the signup body.

### Creating your first admin

`register` always creates a `STUDENT`, and only an `ADMIN` can change roles — so the first admin is a chicken-and-egg problem that the API cannot solve. It has to be written straight to the database.

```bash
node tests/scripts/bootstrap-admin.js
```

Creates (or resets) `admin@infracore.test` / `Admin@12345`. To do it by hand instead: register through the API, open the `user-service` database in Atlas, and set that user's `role` to `"ADMIN"`.

Either way — **log in again afterwards.** The role is baked into the JWT at sign time, so an existing token still carries the old role.

After that, admins promote everyone else via `PATCH /api/v1/users/:id/role`.

---

## Booking state machine

```
                    ┌───────────┐
                    │  PENDING  │  ← created here
                    └─────┬─────┘
          ┌───────────────┼───────────────┐
          │               │               │
      approve          reject          cancel
   (mgr/admin)      (mgr/admin)      (student,
          │               │           own only)
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
   │  RETURNED  │   terminal
   └────────────┘
```

The transition table lives in `booking-service/src/utils/bookingState.js` and is the single source of truth. Any transition not listed is rejected with a 400 naming both states.

Each state stamps its own timestamp field — `approvedAt`, `rejectedAt`, `cancelledAt`, `returnedAt` — so the full history of a booking is readable from the document without an audit table.

**Item availability follows the state machine:**

| Transition | Effect on the item |
|---|---|
| `PENDING → APPROVED` | `isAvailable` set to `false` — item is locked |
| `APPROVED → RETURNED` | `isAvailable` set to `true` — item released |
| `PENDING → REJECTED` / `CANCELLED` | no change — the item was never locked |

---

## Events

Published by booking-service to the `infracore.events` topic exchange:

| Event | Emitted when |
|---|---|
| `BOOKING_CREATED` | A student successfully creates a booking |
| `BOOKING_APPROVED` | A manager or admin approves a pending booking |
| `BOOKING_REJECTED` | A manager or admin rejects a pending booking |
| `BOOKING_CANCELLED` | A student cancels their own pending booking |
| `BOOKING_RETURNED` | A manager or admin marks an approved booking returned |

Messages are published `persistent: true` to a `durable: true` exchange, and consumed from a `durable: true` queue — so events survive a broker restart and a consumer being offline.

---

## Response format

Every endpoint in every service returns the same envelope.

**Success**
```json
{
    "success": true,
    "message": "Booking created",
    "data": { }
}
```

**Failure**
```json
{
    "success": false,
    "message": "Cannot transition from APPROVED to APPROVED"
}
```

| Status | Meaning |
|---|---|
| `400` | Validation failure or illegal state transition |
| `401` | Missing / invalid / expired token, or missing gateway identity headers |
| `403` | Authenticated but the role or ownership check failed |
| `404` | Resource not found |
| `409` | Email already registered |
| `503` | A downstream service was unreachable |
| `500` | Unhandled error |

Validation errors are joined into one message: `"Name must be at least 2 characters, Valid email is required"`.

---

## Project layout

```
InfraCore/
├── api-gateway/
│   └── src/
│       ├── config/          envConfig, servicesConfig (prefix → target table)
│       ├── controllers/     healthController
│       ├── middlewares/     jwtMiddleware, errorMiddleware, notFoundMiddleware
│       ├── routes/          healthRoutes
│       ├── app.js           proxy wiring
│       └── server.js
│
├── services/
│   ├── user-service/
│   ├── inventory-service/
│   ├── booking-service/
│   └── notification-service/
│
├── tests/
│   ├── postman/             collection + environment
│   ├── scripts/             bootstrap-admin, reset-test-data
│   └── README.md            manual test walkthrough
│
├── .env.example             documents every service's vars
├── package.json             concurrently orchestration only
└── README.md
```

Every service follows the same internal shape:

```
src/
├── config/        envConfig.js, dbConfig.js, rabbitmqConfig.js
├── controllers/   thin — parse, delegate, wrap, return
├── middlewares/   auth, role, error, notFound
├── models/        Mongoose schemas
├── routes/        index.js mounts the rest
├── services/      all business logic lives here
├── utils/         apiResponse, appError, asyncHandler
├── validators/    pure functions → { valid, errors }
├── app.js         express wiring
└── server.js      connect dependencies, then listen
```

---

## Design decisions

**Database per service.** No service can read another's collections. Data crosses boundaries only through REST calls or events. `userId` and `itemId` are stored on the Booking document as plain strings, not Mongoose `ObjectId` refs, because a cross-service `.populate()` is exactly the coupling this pattern exists to prevent.

**JWT verified once, at the edge.** Downstream services read `x-user-id` and `x-user-role` and trust them. The gateway strips the incoming `Authorization` header before proxying, so the raw token never travels past the perimeter. In production this trust boundary would be enforced by the network — downstream ports never exposed publicly.

This applies to *all three* downstream services, user-service included. It used to verify the JWT itself, on the reasoning that it owns the signing secret anyway — but that made it unreachable through the gateway, which strips the very header it was reading. Every `/api/v1/users/*` route returned 401. Owning the secret for *signing* at login is a separate concern from verifying on *every request*; only the edge does the latter.

**The gateway rewrites the path before proxying.** `app.use("/api/v1/users", proxy)` makes Express strip the mount prefix from `req.url`, so the proxy would forward `/me` while user-service mounts its router at `/api/v1/users/me`. A `pathRewrite` puts the prefix back. Without it every proxied request 404s while direct-to-service calls work perfectly — a confusing failure, because the gateway looks fine and the service looks fine.

**No shared utility library.** `apiResponse.js`, `appError.js`, and `asyncHandler.js` are copy-pasted into every service. That duplication is intentional: a shared package means every service redeploys when it changes, and coordinated releases are the thing microservices are supposed to eliminate.

**The gateway does not parse request bodies.** There is no `express.json()` in the gateway. Parsing the body would consume the request stream, and the proxied request would arrive downstream empty or hang. The gateway moves bytes; it doesn't inspect them.

**Fail fast on missing infrastructure.** If MongoDB or RabbitMQ can't be reached at startup, the process logs and calls `process.exit(1)`. A service that half-works is harder to diagnose than one that refuses to start.

**Controllers stay thin.** Controllers parse the request, call a service method, wrap the result in `ApiResponse`, and return. Every rule, every cross-model coordination, every event publish lives in `services/*.js`. Async controllers are wrapped in `asyncHandler` rather than carrying their own `try/catch`, and they throw `AppError` — the error middleware turns it into a response.

**Item name is snapshotted.** A Booking stores `itemName` at creation time. If the item is later renamed or deleted, historical bookings still read correctly.

---

## Troubleshooting

**Every authenticated request returns 401**
`JWT_SECRET` differs between `api-gateway/.env` and `services/user-service/.env`. They must match exactly.

**`RabbitMQ Connection Failed` and the process exits**
The broker isn't running. Start it, then confirm port 5672 is listening. Booking-service and notification-service both refuse to start without it.

**Requests to `/api/v1/bookings` return `ECONNREFUSED`**
Booking-service isn't up. The gateway proxies blindly — it doesn't health-check its targets.

**`Missing gateway identity headers` (401) when calling a service directly**
Expected. Downstream services only accept `x-user-id` / `x-user-role`. Either go through the gateway on port 3000, or pass the headers yourself when testing in isolation:
```bash
curl http://localhost:4001/api/v1/inventory \
  -H "x-user-id: 123" -H "x-user-role: ADMIN"
```

**A role change doesn't take effect**
The role is embedded in the JWT at sign time. Log in again to get a token carrying the new role.

**`Failed to update item availability` (503)**
Booking-service couldn't reach inventory-service, or inventory-service rejected the call. Note that the availability endpoint requires a manager/admin role, and booking-service forwards the *original caller's* role.

**Notifications never appear**
Check the queue in the management UI at http://localhost:15672. If `notification.bookings` is filling but not draining, notification-service isn't consuming — restart it. If the queue doesn't exist at all, notification-service has never successfully started.

---

## What this project demonstrates

- Service decomposition along business capabilities
- Database-per-service isolation with no shared schema
- Edge authentication and identity propagation via headers
- Synchronous inter-service HTTP where consistency is needed
- Asynchronous event-driven messaging via a durable topic exchange
- A pure consumer service with no business HTTP surface
- Role-based access control enforced independently in each service
- Domain state machine validation at the service layer
- Consistent error and response contracts across five independent processes
