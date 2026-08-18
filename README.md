# InfraCore

A distributed microservices platform for managing shared organizational assets — laptops, projectors, lab equipment, cameras, and other institutional resources. Built as an event-driven system with hard service boundaries, database-per-service isolation, edge authentication, and both synchronous and asynchronous inter-service communication.

The domain is a university asset-borrowing system, but the architecture is domain-agnostic.

Redis sits behind three separate concerns — distributed rate limiting and JWT revocation at the edge, and a cache-aside read cache in front of the item catalog. The notification consumer runs a full dead-letter pipeline: failed deliveries retry with exponential backoff and, once retries are exhausted, park in a queue an operator can inspect and replay over HTTP.

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
- [Rate limiting](#rate-limiting)
- [Token revocation](#token-revocation)
- [Inventory caching](#inventory-caching)
- [Retries and the dead-letter queue](#retries-and-the-dead-letter-queue)
- [Booking state machine](#booking-state-machine)
- [Events](#events)
- [Response format](#response-format)
- [Project layout](#project-layout)
- [Design decisions](#design-decisions)
- [Troubleshooting](#troubleshooting)
- [What I would improve next](#what-i-would-improve-next)

---

## Architecture

Five Node processes. One public entry point. Three private databases. One message broker. One Redis instance, shared by three of the five.

```
                            ┌──────────────┐
                            │    Client    │
                            └──────┬───────┘
                                   │  Authorization: Bearer <JWT>
                                   ▼
              ┌────────────────────────────────────────────┐     ┌──────────────────┐
              │            API GATEWAY  :3000              │     │      REDIS       │
              │                                            │     │      :6379       │
              │  1. rate limit  (IP on /auth/*, else uid)  │◀───▶│ rl:auth:<ip>     │
              │  2. verify JWT   (skipped for /auth/*)     │     │ rl:user:<id>     │
              │  3. reject if the token's jti is revoked   │◀───▶│ bl:jti:<jti>     │
              │  4. decode -> req.user = { id, role, jti } │     │ inv:item:<id>    │
              │  5. inject x-user-id / -role / -jti / -exp │     │ inv:list:<hash>  │
              │  6. strip   Authorization header           │     │ inv:mine:<uid>   │
              │  7. restore path, then proxy by prefix     │     └──────────────────┘
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
        │ logout / revoke │ │ read cache   │ │                  │
        │ profiles / RBAC │ │ (cache-aside)│ │                  │
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
                                             │   durable, DLX to retry  │
                                             └────────────┬─────────────┘
                                                          ▼
                                             ┌──────────────────────────┐
                                             │  NOTIFICATION SERVICE    │
                                             │           :4003          │
                                             │  consumer, no database   │
                                             │  retry + parking queues  │
                                             │  /admin DLQ routes only  │
                                             └──────────────────────────┘
```

Only the gateway is drawn touching Redis, to keep the diagram readable. User-service writes blacklist keys to that same instance on logout, and inventory-service owns the `inv:*` cache keys — three of the five processes share one Redis.

**Two communication styles, used deliberately:**

| Style | Where | Why |
|---|---|---|
| **Synchronous HTTP** | Booking → Inventory | The caller needs an answer *now* — is this item available? — before it can decide whether to create the booking. |
| **Asynchronous events** | Booking → RabbitMQ → Notification | Nobody is waiting on a notification. Sending it must not slow down, or be able to fail, the booking request. |

Redis is deliberately *not* a third style. Nothing publishes to it and nothing subscribes; no service reaches another through it. It holds three kinds of derived state — rate-limit counters, revoked token ids, cached reads — every one of which can be discarded and rebuilt from the source of truth. That property is exactly what licenses every Redis call site to fail open.

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
      • GET bl:jti:<jti>   →  key present? 401 "Token has been revoked"
      • req.user = { id: "665a...", role: "STUDENT", jti, exp }
                │
                ▼
2b. API Gateway  (userRateLimit)
      • INCR rl:user:665a...     →  returned 1? EXPIRE 60
      • count > RATE_LIMIT_MAX   →  429 + Retry-After
      • sets X-RateLimit-Limit / -Remaining / -Reset
                │
                ▼
 3. API Gateway  (proxyReq hook)
      • sets  x-user-id:   665a...
      • sets  x-user-role: STUDENT
      • sets  x-user-jti / x-user-exp   ← so /logout can revoke this token
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
 5. Booking Service  (authMiddleware only)
      • any authenticated user may book — ownership rules run in the service
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
      inventory checks inv:item:<id> first, falls through to Mongo on a miss
                │
                ├─ 404      →  AppError("Item not found", 404)
                ├─ down     →  AppError("Inventory service unavailable", 503)
                └─ 200      →  item
                │
                ▼
 8. Booking Service  (domain rules)
      • item.ownerId === caller         →  AppError("You cannot book your own item", 400)
      • !item.isListed || item.isOnLoan →  AppError("Item is not available", 400)
      • otherwise persist Booking { status: "PENDING", itemName, ownerId: <snapshots> }
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
      • bookingCreatedHandler → await notifier.send(...) → console
      • resolved →  channel.ack(msg)
      • threw    →  republish to infracore.retry with a TTL, then ack
                    (retry ladder below; parked once retries run out)
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
   await handler(data)     park it         park it
              │               │               │
        ┌─────┴─────┐      ack()           ack()
        ▼           ▼
    resolved      threw
        │           │
      ack()   retry, or park
                    │   once retries run out
                    ▼
         see "Retries and the
         dead-letter queue"
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
| Message broker | RabbitMQ (amqplib), topic exchange + retry/parking queues |
| Cache, rate limiter, token blacklist | Redis 7 (`redis` v4 client) |
| Auth | jsonwebtoken (HS256) + bcryptjs |
| Validation | `validator` + hand-rolled validators returning `{ valid, errors }` |
| Gateway proxy | http-proxy-middleware 3 |
| Inter-service HTTP | axios |
| Dev orchestration | concurrently |
| Module system | CommonJS (`require` / `module.exports`) |

No TypeScript, no shared library between services, and no Docker for the application processes — all deliberate. See [Design decisions](#design-decisions). Redis and RabbitMQ are the only pieces worth containerising, and only because installing them natively is more trouble than it is worth.

---

## Prerequisites

- **Node.js 18+**
- **MongoDB Atlas** cluster (free tier is fine) with three databases: `user-service`, `inventory-service`, `booking-service`
- **RabbitMQ** running locally on port 5672
- **Redis 7** running locally on port 6379

### Installing Redis

With Docker:
```bash
docker run -d -p 6379:6379 --name infra-redis redis:7-alpine
```

Natively: `brew install redis && brew services start redis` on macOS, `sudo apt install redis-server` on Ubuntu/WSL. On Windows use Docker or WSL — there is no maintained native build.

Confirm it answers:
```bash
redis-cli ping     # → PONG
```

Nothing in the platform *requires* Redis to be up. Every call site fails open, so with Redis down you lose rate limiting, logout revocation, and the read cache while every endpoint keeps working. That is deliberate — see [Design decisions](#design-decisions).

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

Three services also read `REDIS_URL` — gateway, user-service, inventory-service. The default `redis://localhost:6379` is correct for a local install, so leave it alone unless Redis lives elsewhere. Notification-service needs an `ADMIN_API_SECRET` before its `/admin` routes will answer anything but `401`.

Generate a strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **`JWT_SECRET` must be byte-identical in `api-gateway/.env` and `services/user-service/.env`.**
> User-service signs the token; the gateway verifies it. A mismatch means every authenticated request 401s at the edge.

> **`REDIS_URL` must point at the same instance in `api-gateway/.env` and `services/user-service/.env`.**
> User-service *writes* the blacklist key on logout; the gateway *reads* it on every request. Point them at different instances and logout will cheerfully report success while the revoked token keeps working.

**3. Run everything**
```bash
npm run dev
```

All five processes start in parallel with colour-coded, prefixed logs:

```
[user]         MongoDB Connected
[user]         [user-service] Redis ready
[user]         User Service running on port 4000
[inventory]    MongoDB Connected
[inventory]    [inventory-service] Redis ready
[inventory]    Inventory Service running on port 4001
[booking]      MongoDB Connected
[booking]      RabbitMQ Connected
[booking]      Booking Service running on port 4002
[notification] [notification-service] RabbitMQ connected + retry topology ready
[notification] [notification-service] consuming from notification.bookings (max 3 retries)
[notification] Notification Service running on port 4003
[gateway]      [gateway] Redis ready
[gateway]      API Gateway running on port 3000
```

To run a single service instead:
```bash
npm --prefix services/user-service run dev
```

---

## Environment variables

Every variable is read exactly once, in that service's `src/config/envConfig.js`, and re-exported. Exactly one module breaks that rule: `notification-service/src/services/notifierService.js` reads `FORCE_FAILURE_RATE` straight from `process.env`, on the reasoning that it is a test-only lever rather than real configuration. It is the one place worth tidying if you want the invariant to hold everywhere.

| Service | Variables |
|---|---|
| `api-gateway` | `PORT`, `JWT_SECRET`, `USER_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `BOOKING_SERVICE_URL`, `REDIS_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_SECONDS` |
| `user-service` | `PORT`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REDIS_URL` |
| `inventory-service` | `PORT`, `MONGODB_URI`, `INTERNAL_API_SECRET`, `REDIS_URL`, `CACHE_ITEM_TTL_SECONDS`, `CACHE_LIST_TTL_SECONDS` |
| `booking-service` | `PORT`, `MONGODB_URI`, `INVENTORY_SERVICE_URL`, `INTERNAL_API_SECRET`, `RABBITMQ_URL`, `RABBITMQ_EXCHANGE` |
| `notification-service` | `PORT`, `RABBITMQ_URL`, `RABBITMQ_EXCHANGE`, `RABBITMQ_QUEUE`, `RABBITMQ_RETRY_EXCHANGE`, `RABBITMQ_RETRY_QUEUE`, `RABBITMQ_PARKING_QUEUE`, `RETRY_BASE_DELAY_MS`, `MAX_RETRIES`, `ADMIN_API_SECRET` |

Three values must agree across service boundaries, and each fails in its own way:

| Variable | Shared between | Symptom when mismatched |
|---|---|---|
| `JWT_SECRET` | gateway ↔ user-service | every authenticated request 401s |
| `REDIS_URL` | gateway ↔ user-service | logout succeeds, revoked token still works |
| `INTERNAL_API_SECRET` | booking ↔ inventory | approve / return fails with 503 |

The root [`.env.example`](.env.example) documents all of them in one place for reference. The root itself reads no env vars.

---

## API reference

Everything below goes through the gateway on port 3000.

### Auth — public

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/auth/register` | `{ name, email, password }` |
| `POST` | `/api/v1/auth/login` | `{ email, password }` |

### Auth — authenticated

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/v1/auth/logout` | any authenticated user |

Logout is authenticated rather than public, because the server needs the gateway to tell it *which* token to revoke. See [Token revocation](#token-revocation).

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
| `GET` | `/api/v1/inventory/mine` | any authenticated user |
| `GET` | `/api/v1/inventory/:id` | any authenticated user |
| `POST` | `/api/v1/inventory` | any authenticated user (caller becomes owner) |
| `PATCH` | `/api/v1/inventory/:id` | item owner, `RESOURCE_MANAGER`, `ADMIN` |
| `DELETE` | `/api/v1/inventory/:id` | item owner, `RESOURCE_MANAGER`, `ADMIN` |
| `PATCH` | `/api/v1/inventory/:id/availability` | item owner, `RESOURCE_MANAGER`, `ADMIN` |
| `PATCH` | `/api/v1/inventory/:id/loan` | internal (booking-service, shared secret) |

Filters on the list endpoint: `?category=`, `?department=`, `?available=true|false`

### Bookings

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/v1/bookings` | any authenticated user (not on own items) |
| `GET` | `/api/v1/bookings/me` | any authenticated user |
| `GET` | `/api/v1/bookings/owner` | any authenticated user (requests on own items) |
| `GET` | `/api/v1/bookings` | `RESOURCE_MANAGER`, `ADMIN` |
| `GET` | `/api/v1/bookings/:id` | borrower, item owner, or `RESOURCE_MANAGER`/`ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/approve` | item owner, `ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/reject` | item owner, `ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/return` | item owner, `ADMIN` |
| `PATCH` | `/api/v1/bookings/:id/cancel` | borrower, `ADMIN` |

### Admin — dead-letter queue

Served by notification-service on port **4003 directly**, not through the gateway: these are operator endpoints, not user-facing API. Each requires an `x-admin-secret` header matching `ADMIN_API_SECRET`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/parking/depth` | how many messages are parked |
| `GET` | `/admin/parking/peek?limit=10` | inspect parked messages without consuming them |
| `POST` | `/admin/parking/replay` | re-publish parked messages to the main exchange (`{ limit }`, default 100) |
| `DELETE` | `/admin/parking` | purge the parking queue permanently |

### Health

Each process exposes an unauthenticated `GET /health`: ports 3000, 4000, 4001, 4002, 4003.

The gateway mounts `/health` before the rate limiters, so liveness probes never consume a client's quota.

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

Register a second account the same way and keep its token as `OWNER_TOKEN` — that account will publish the item.

```bash
# 3. Owner publishes an item (any user can)
curl -X POST http://localhost:3000/api/v1/inventory \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dell Latitude 5420","category":"Laptop","department":"CSE"}'

# 4. Student browses what is available
curl "http://localhost:3000/api/v1/inventory?available=true" \
  -H "Authorization: Bearer $STUDENT_TOKEN"

# 5. Student books it  →  BOOKING_CREATED fires (owner + borrower notified)
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"<item id from step 4>"}'

# 6. Owner sees the incoming request, then approves it
#    →  BOOKING_APPROVED fires, item locked (isOnLoan: true)
curl http://localhost:3000/api/v1/bookings/owner \
  -H "Authorization: Bearer $OWNER_TOKEN"
curl -X PATCH http://localhost:3000/api/v1/bookings/<bookingId>/approve \
  -H "Authorization: Bearer $OWNER_TOKEN"

# 7. Owner confirms the return  →  BOOKING_RETURNED fires, item released
curl -X PATCH http://localhost:3000/api/v1/bookings/<bookingId>/return \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Watch the `[notification]` lane in your terminal — `===== NOTIFICATION =====` blocks appear addressed to the borrower and the owner.

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
| `STUDENT` | Publish items, manage own items, approve/reject/return bookings **on own items**, book other users' items, cancel own bookings |
| `RESOURCE_MANAGER` | Everything above, plus manage **any** item in the catalog and view all bookings |
| `ADMIN` | Everything above, plus drive any booking transition, list all users and change any user's role |

Item ownership is the primary authorization axis: whoever publishes an item (`ownerId`) controls its listing and the booking requests on it. Roles only add moderation powers on top.

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

## Rate limiting

A counter that lives inside the process it protects stops being a limit the moment you run two of them. Each instance keeps its own tally, so a client's real budget becomes a function of your replica count. Moving the counter into Redis makes the limit a property of the system rather than of a process.

InfraCore uses a **fixed-window counter** — two Redis commands per request:

```
INCR   rl:user:665a...        → 4
EXPIRE rl:user:665a... 60     → only when INCR returned 1
```

`INCR` is atomic, so two concurrent requests cannot both read `4` and both write `5`. The `EXPIRE` is applied only on the first hit of a window; without it the key would outlive the window and lock the client out permanently.

Two limiters, keyed differently:

| Limiter | Applies to | Keyed on | Default |
|---|---|---|---|
| `authRateLimit` | `/api/v1/auth/*` | client IP | 10 per 60s |
| `userRateLimit` | every protected prefix | `req.user.id`, IP as fallback | 100 per 60s |

The split is the interesting part. Auth endpoints have no authenticated user to key on yet, and they are precisely what credential stuffing hammers — so they key on IP and get a much tighter budget. Everything else keys on user id, so one abusive client cannot spend another user's quota, and a shared campus NAT egress doesn't throttle everyone behind it.

Middleware order in `app.js` is load-bearing:

```js
app.use(svc.prefix, authRateLimit, proxy);              // public
app.use(svc.prefix, verifyJwt, userRateLimit, proxy);   // protected
```

`verifyJwt` must run *before* `userRateLimit`, because the limiter keys on `req.user.id`, which does not exist until the token is decoded. Swap them and every authenticated request silently falls back to IP-keying — no error, just a limit that quietly stops doing what you think it does.

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; a rejection is `429` with `Retry-After`.

`app.set("trust proxy", 1)` matters here: without it `req.ip` reports the loopback address of whatever proxy fronts the gateway, collapsing every client in the world into one rate-limit key.

**The trade-off worth naming.** A fixed window lets a client burst 2× the limit across a boundary — 100 requests at `11:59:59.9`, 100 more at `12:00:00.1`. A sliding-window log fixes that but stores a timestamp per request; a token bucket fixes it but needs a Lua script to stay atomic. Here the boundary burst is theoretical and the extra Redis traffic would be real.

---

## Token revocation

A JWT is valid because its signature checks out, not because a server says so. That is what makes it cheap to verify, and it is the same property that makes "log me out" awkward — there is no record to delete.

The common fix is a `tokenVersion` column on the user row, bumped on logout and compared on every request. It works, but it puts a database read on the hot path of every authenticated request forever, to catch a case that almost never fires.

InfraCore keys revocation on a **`jti`** instead — a unique id minted per token (RFC 7519 §4.1.7):

```js
const jti = crypto.randomUUID();
return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
```

Logout writes exactly one key, with a TTL equal to the token's own remaining life:

```
SET bl:jti:<jti> "user-logout" EX (exp - now)
```

The gateway checks that key after verifying the signature: one O(1) in-memory lookup instead of an indexed document read. The entry then **deletes itself** at the moment the token would have expired anyway — no sweeper job, no unbounded growth, no key outliving its purpose.

Per-token granularity is the other reason for a `jti`. Bumping a `tokenVersion` kills every session a user has; revoking a `jti` logs out the one device that asked to be logged out.

### The awkward part: logout cannot see its own token

The gateway strips `Authorization` before proxying, so by the time `/logout` reaches user-service the raw JWT is gone. The service is being asked to revoke a token it cannot read.

Two clean ways out:

1. Have the gateway forward the `jti` in a header
2. Have the client re-send the token in the request body

InfraCore takes the first. The gateway already decoded the token, so it forwards `x-user-jti` and `x-user-exp` next to the existing identity headers, and logout stays an ordinary authenticated request. The second option would have made logout the one endpoint whose client contract differs from every other endpoint in the system.

```
POST /api/v1/auth/logout
   gateway      →  x-user-id, x-user-role, x-user-jti, x-user-exp
   user-service →  SET bl:jti:<jti> EX (exp - now)
   next request carrying that token  →  401 "Token has been revoked"
```

> **The routing trap this creates.** `/api/v1/auth` is a *public* prefix — it skips `verifyJwt` so that register and login work without a token. But logout needs the opposite: it only works if the gateway has already decoded the token and forwarded `x-user-jti`. Left under the public prefix, `POST /logout` returns `401 "Missing gateway identity headers"`, and — worse — reports nothing wrong at the gateway. The token is simply never revoked.
>
> `servicesConfig.js` therefore lists `/api/v1/auth/logout` as a protected prefix **before** the public `/api/v1/auth` entry. Express matches the first mount that fits, so ordering is what makes it work; move it after and the public entry swallows it again.

---

## Inventory caching

Inventory reads dominate this system. Every browse and every booking attempt begins with one, and they are overwhelmingly repeat reads of the same few items — the textbook shape for a cache.

The pattern is **cache-aside**, chosen over write-through for one reason: the application decides when reads and writes happen, so Redis being unavailable degrades latency rather than correctness.

```
read    GET inv:item:<id>   →  hit?  return it
                            →  miss? read Mongo, SET with TTL, return

write   write Mongo FIRST, then DEL the cache key
```

That write order is not stylistic. Invalidating first leaves a window in which a concurrent reader misses, loads the *old* row, and repopulates the cache with stale data that then survives a full TTL. Writing first closes the window.

Three key namespaces:

| Key | Holds | TTL |
|---|---|---|
| `inv:item:<id>` | one item | 300s |
| `inv:list:<hash>` | one filtered list, hashed from the filter object | 60s |
| `inv:mine:<ownerId>` | one owner's items | 60s |

Filtered lists are the hard case. `?category=laptop&available=true` and `?department=CSE` are different keys, and there are combinatorially many of them — so when an item changes there is no way to know which cached lists contained it. `cacheService` therefore registers every list key in a Redis set (`inv:list-index`) and deletes the lot on any write.

**Stated plainly, that is wasteful:** a single write invalidates list caches that never contained the changed item. It is acceptable here because writes are a tiny fraction of traffic and lists already expire in 60 seconds. At real scale you would keep a per-item → list-key reverse index and pay memory to shrink the blast radius.

One detail worth noticing in `inventoryService.js`: the write paths call `Item.findById(id)` directly rather than the cached `getItemById`. Ownership checks have to run against the true current row — authorising a mutation from a cached copy is how stale-permission bugs are born.

Short TTLs are a backstop, not the mechanism. Invalidation is meant to be correct; the TTL only bounds how wrong things can get if an invalidation is ever lost to a network blip.

---

## Retries and the dead-letter queue

The original consumer did this:

```js
try { handler(payload.data); channel.ack(msg); }
catch { channel.nack(msg, false, false); }   // discarded
```

Two bugs in three lines. The handler was never awaited, so an async failure never reached the `catch` at all — and anything that did was thrown away. Thirty seconds of SMTP trouble meant every notification in that window was gone: booking written to the database, user never told.

The fix has two halves. Handlers became `async` and `await` their sends, so failures actually propagate. And a failure now means *retry*, not *discard*.

### Why not simply requeue

`nack(msg, false, true)` redelivers immediately. Against a downstream that is genuinely down that is a hot loop — the same message, thousands of times a second, until something falls over. Retries are only useful when they are spaced out, and spacing them out means the message needs somewhere to wait.

That somewhere is a retry queue whose TTL expiry dead-letters back to the main exchange:

```
notification.bookings ──(handler threw)──► infracore.retry (direct)
                                                   │
                                                   ▼
                                     notification.bookings.retry
                                       • per-message TTL: 5s, 10s, 20s
                                       • x-dead-letter-exchange =
                                             infracore.events
                                                   │  TTL expires
                                                   ▼
                                     back into notification.bookings
                                                   │
                                          (retries exhausted)
                                                   ▼
                                     notification.bookings.parking
                                       • nothing consumes it
                                       • drained only by an operator
```

Backoff is exponential — `RETRY_BASE_DELAY_MS * 2^attempt` — and that is precisely why the consumer republishes by hand instead of nacking. A queue-level `x-message-ttl` applies one delay to every message in the queue; only a publisher can set a per-message `expiration`, and per-message is what "5s, then 10s, then 20s" requires.

### Parking is terminal on purpose

After `MAX_RETRIES` the message is published to a parking queue with the failure reason, the original routing key and a timestamp attached as headers. Nothing consumes that queue.

If three spaced-out attempts all failed, the cause is almost certainly systemic — bad config, a provider outage, malformed data — and automatic retries would just keep hammering something already unwell. A human decides when the underlying problem is fixed:

```bash
export S=your-admin-secret
curl -H "x-admin-secret: $S" localhost:4003/admin/parking/depth
curl -H "x-admin-secret: $S" "localhost:4003/admin/parking/peek?limit=5"
curl -X POST   -H "x-admin-secret: $S" localhost:4003/admin/parking/replay
curl -X DELETE -H "x-admin-secret: $S" localhost:4003/admin/parking
```

Replay strips the `x-death` chain and republishes under the original routing key, so a replayed message gets a full fresh retry budget.

Poison messages skip the ladder entirely. A payload that will not parse, or an event with no registered handler, fails identically on every attempt — so the consumer parks those immediately rather than spending three retries proving it.

### Trying it end to end

```bash
cd services/notification-service
FORCE_FAILURE_RATE=1 npm run dev
```

Every send now throws. Trigger a booking, watch the retry ladder in the logs, then watch `/admin/parking/depth` climb once attempts run out. Set `FORCE_FAILURE_RATE=0`, restart, and `POST /admin/parking/replay` to drain everything back through successfully.

> **Known bug in the current consumer.** `countPreviousAttempts()` counts `x-death` entries whose `queue` is the **main** queue. But the retry path acks the original and republishes by hand, so the broker only ever records a death against the **retry** queue. The count therefore stays at `0`, `attempts >= MAX_RETRIES` never becomes true, and messages retry forever instead of parking. Matching on `RABBITMQ_RETRY_QUEUE` instead is the one-line fix. Worth doing before demoing the parking queue, because as written it never fills.

---

## Booking state machine

```
                    ┌───────────┐
                    │  PENDING  │  ← created here
                    └─────┬─────┘
          ┌───────────────┼───────────────┐
          │               │               │
      approve          reject          cancel
  (owner/admin)    (owner/admin)    (borrower,
          │               │           own only)
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌─────────────┐
   │  APPROVED  │  │  REJECTED  │  │  CANCELLED  │
   └──────┬─────┘  └────────────┘  └─────────────┘
          │            terminal        terminal
       return
  (owner/admin)
          │
          ▼
   ┌────────────┐
   │  RETURNED  │   terminal
   └────────────┘
```

The transition table lives in `booking-service/src/utils/bookingState.js` and is the single source of truth. Any transition not listed is rejected with a 400 naming both states.

Each state stamps its own timestamp field — `approvedAt`, `rejectedAt`, `cancelledAt`, `returnedAt` — so the full history of a booking is readable from the document without an audit table.

**The item's loan lock follows the state machine:**

| Transition | Effect on the item |
|---|---|
| `PENDING → APPROVED` | `isOnLoan` set to `true` — item is locked |
| `APPROVED → RETURNED` | `isOnLoan` set to `false` — item released |
| `PENDING → REJECTED` / `CANCELLED` | no change — the item was never locked |

The owner's manual listing toggle (`isListed`, via `PATCH /inventory/:id/availability`) is independent of the loan lock; an item is bookable only when `isListed && !isOnLoan`.

---

## Events

Published by booking-service to the `infracore.events` topic exchange:

| Event | Emitted when |
|---|---|
| `BOOKING_CREATED` | A user successfully creates a booking |
| `BOOKING_APPROVED` | The item's owner (or admin) approves a pending booking |
| `BOOKING_REJECTED` | The item's owner (or admin) rejects a pending booking |
| `BOOKING_CANCELLED` | The borrower cancels their own pending booking |
| `BOOKING_RETURNED` | The item's owner (or admin) marks an approved booking returned |

Messages are published `persistent: true` to a `durable: true` exchange, and consumed from a `durable: true` queue — so events survive a broker restart and a consumer being offline.

Delivery is **at-least-once**, and the handlers are not idempotent. `bookingCreatedHandler` notifies the borrower and then the owner in sequence, so a failure on the second send replays the first when the message is retried. For notifications a duplicate is annoying rather than wrong; for a payment it would be unacceptable. See [Retries and the dead-letter queue](#retries-and-the-dead-letter-queue).

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
| `429` | Rate limit exceeded — see the `Retry-After` and `X-RateLimit-*` headers |
| `503` | A downstream service was unreachable |
| `500` | Unhandled error |

Validation errors are joined into one message: `"Name must be at least 2 characters, Valid email is required"`.

---

## Project layout

```
InfraCore/
├── api-gateway/
│   └── src/
│       ├── config/          envConfig, servicesConfig (prefix → target table),
│       │                    redisConfig (shared client, fails open)
│       ├── controllers/     healthController
│       ├── middlewares/     jwtMiddleware (verify + blacklist check),
│       │                    rateLimitMiddleware, errorMiddleware, notFoundMiddleware
│       ├── routes/          healthRoutes
│       ├── app.js           proxy wiring, rate limiter ordering
│       └── server.js        connects Redis, then listens
│
├── services/
│   ├── user-service/        + redisConfig, tokenBlacklistService
│   ├── inventory-service/   + redisConfig, cacheService
│   ├── booking-service/       (unchanged — no Redis, no DLQ)
│   └── notification-service/+ dlqService, adminController,
│                              adminRoutes, adminAuthMiddleware
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

Notification-service is the partial exception. It has no `models/` or `validators/` because it owns no data, and its `routes/` and `controllers/` exist solely to serve the DLQ admin API.

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

**Every Redis call site fails open.** If Redis is unreachable the rate limiter calls `next()`, the blacklist check treats the token as valid, and the cache reports a miss and falls through to Mongo. The alternative — refusing requests when the cache is down — turns a degraded secondary control into a total outage. The cost of failing open is bounded and self-healing: an abusive client gets through for a few seconds, or a revoked token survives until its natural expiry, which it would have done anyway. Availability of the primary path is worth more than perfect enforcement of a secondary one.

This directly contradicts **fail fast on missing infrastructure** above, and the contradiction is the point. MongoDB and RabbitMQ hold truth — a service without its database cannot answer correctly, so it should refuse to start. Redis holds only derived state that can be rebuilt from the source of truth at any time, so it should never be able to take a service down. The test is not "how important is this dependency" but "does it hold truth, or a copy of it".

**Admin DLQ routes use a shared secret, not a role.** `/admin/*` on notification-service checks an `x-admin-secret` header rather than an `ADMIN` JWT role, and is reached directly on port 4003 rather than through the gateway. These endpoints exist to be used when the platform is unhealthy, which is exactly when you would rather not depend on user-service being up to authenticate you. In production the static string would become mTLS or a service-account token.

**Notification-service grew an HTTP surface, reluctantly.** It was a pure consumer with nothing but `/health`. The DLQ admin API is the one thing that justified adding routes to it: a parking queue nobody can inspect is just a slower way of dropping messages.

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

**`Failed to update item loan status` (503)**
Booking-service couldn't reach inventory-service, or inventory-service rejected the loan call. Check that `INTERNAL_API_SECRET` is set to the **same value** in both services' `.env` files — a mismatch surfaces here as a 503.

**Notifications never appear**
Check the queue in the management UI at http://localhost:15672. If `notification.bookings` is filling but not draining, notification-service isn't consuming — restart it. If the queue doesn't exist at all, notification-service has never successfully started.

**`Cannot find module 'redis'`**
The dependency is declared in `package.json` but was never installed. Run `npm run install:all` from the repo root.

**Every request returns 429**
Rate limiting. Defaults are 100 requests / 60s per user, and 10 / 60s per IP on `/api/v1/auth/*`. Raise `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX`, or clear the counters:
```bash
redis-cli --scan --pattern 'rl:*' | xargs redis-cli del
```

**Logout returns success but the token still works**
The gateway and user-service are pointed at different Redis instances — `REDIS_URL` must match in both `.env` files. Confirm the key exists after a logout with `redis-cli keys 'bl:jti:*'`. If Redis was down at logout time the revocation was skipped by design; user-service logs a warning when that happens.

**Inventory returns stale data after an update**
Invalidation didn't run, or ran against a different Redis. Inspect with `redis-cli get inv:item:<id>`. Entries self-expire after 300s (items) and 60s (lists), so staleness is bounded even when an invalidation is lost. To clear manually:
```bash
redis-cli --scan --pattern 'inv:*' | xargs redis-cli del
```

**The parking queue never fills**
Expected, given the `x-death` counting bug documented under [Retries and the dead-letter queue](#retries-and-the-dead-letter-queue) — messages retry indefinitely instead of parking.

**Notification-service crashes on boot with `PRECONDITION_FAILED - inequivalent arg 'x-dead-letter-exchange'`**
The queue already exists from before the DLQ upgrade, declared without dead-letter arguments, and RabbitMQ refuses to redeclare a queue with different arguments. This hits every environment that ran the pre-upgrade code — it is a migration step, not a bug. Check the depth first, then drop the queue so the new topology can be declared:
```bash
docker exec rabbitmq rabbitmqctl list_queues name messages
docker exec rabbitmq rabbitmqctl delete_queue notification.bookings
```
Anything still queued is lost, so drain it first if the count is non-zero. Restart notification-service and it will recreate the queue with the correct `x-dead-letter-exchange` argument, alongside the retry and parking queues.

**`/admin/parking/*` returns 401**
`ADMIN_API_SECRET` is unset, or doesn't match the `x-admin-secret` header. Note these routes are served on port 4003 directly, not through the gateway on 3000.

---

## What this project demonstrates

- Service decomposition along business capabilities
- Database-per-service isolation with no shared schema
- Edge authentication and identity propagation via headers
- Synchronous inter-service HTTP where consistency is needed
- Asynchronous event-driven messaging via a durable topic exchange
- A pure consumer service with no business HTTP surface
- Ownership-based access control layered over roles, enforced in each service
- Service-to-service authentication via a shared internal secret
- Domain state machine validation at the service layer
- Consistent error and response contracts across five independent processes
- Distributed rate limiting with atomic Redis counters, keyed by identity at the edge
- Revocation of stateless tokens via a `jti` blacklist whose keys expire themselves
- Cache-aside reads with write-order-correct invalidation and bounded staleness
- Graceful degradation: a dependency failure narrows features instead of ending availability
- Exponential-backoff retries, a terminal parking queue, and an operator API over it
- Honest accounting of delivery semantics — at-least-once, non-idempotent handlers, and what that costs

---

## What I would improve next

Roughly the order I would actually do them in.

**Fix the retry counter.** The `x-death` bug documented above means the parking queue never fills, which makes the whole DLQ pipeline decorative. One line.

**Idempotency keys on handlers.** At-least-once delivery plus non-idempotent handlers means a retry re-sends notifications that already succeeded. Checking an event id against a small collection before processing would make replay safe, and would matter enormously if this pattern were ever reused for a payment.

**Per-tag cache invalidation.** Nuking every list cache on every write is correct but wasteful. A per-item → list-key reverse index would shrink the blast radius at the cost of memory.

**A Lua-scripted sliding window.** One atomic script would remove the 2× boundary burst without giving up atomicity — the honest fix for the fixed-window trade-off.

**Redis and RabbitMQ are both single points of failure.** Sentinel or Cluster for Redis, a mirrored queue policy for RabbitMQ. Failing open limits today's damage; it doesn't remove the risk.

**The outbox pattern on the publisher side.** Booking-service writes to Mongo and then publishes to RabbitMQ as two separate operations, so a crash between them loses the event silently. Writing events to an outbox collection in the same transaction and relaying them from there closes the gap.

**Metrics before any of the tuning above.** Cache hit ratio, 429 rate, parking depth, retry counts. None of these decisions should be made blind.

**Automated tests.** There are still none.
