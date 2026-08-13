# Inventory Service

Owns the item catalog — the physical assets that can be borrowed. **Any authenticated user can publish items**; each item is managed by its publisher (owner). `RESOURCE_MANAGER` and `ADMIN` can manage any item.

Runs on port **4001**, backed by the `inventory-service` database.

This service also acts as the availability authority: booking-service calls it synchronously to check whether an item can be booked, and to lock or release it as bookings move through their lifecycle.

---

## Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/v1/inventory` | any authed user | List items, with filters |
| `GET` | `/api/v1/inventory/mine` | any authed user | List items the caller published |
| `GET` | `/api/v1/inventory/:id` | any authed user | Fetch a single item |
| `POST` | `/api/v1/inventory` | any authed user | Publish an item (caller becomes owner) |
| `PATCH` | `/api/v1/inventory/:id` | owner, `RESOURCE_MANAGER`, `ADMIN` | Update an item |
| `DELETE` | `/api/v1/inventory/:id` | owner, `RESOURCE_MANAGER`, `ADMIN` | Delete an item |
| `PATCH` | `/api/v1/inventory/:id/availability` | owner, `RESOURCE_MANAGER`, `ADMIN` | List/delist the item (`isListed`) |
| `PATCH` | `/api/v1/inventory/:id/loan` | internal (shared secret) | Lock/release the item for a loan (`isOnLoan`) |
| `GET` | `/health` | public | Liveness check |

Ownership is enforced in the **service layer** (`assertCanManage`), not by route middleware — the route can't know who owns an item before loading it.

### Filters

`GET /api/v1/inventory` accepts three optional query parameters:

| Parameter | Example | Behaviour |
|---|---|---|
| `category` | `?category=Laptop` | Exact match |
| `department` | `?department=CSE` | Exact match |
| `available` | `?available=true` | Compared as a string — `"true"` means bookable (`isListed && !isOnLoan`), `"false"` the opposite |

Combine freely: `?category=Laptop&department=CSE&available=true`

Results are sorted newest first (`createdAt` descending). Unrecognised query parameters are ignored.

---

## Data model

```js
{
    name:        String,   // required, trimmed
    category:    String,   // required, trimmed — e.g. "Laptop", "Projector"
    department:  String,   // required, trimmed — e.g. "CSE", "Physics"
    description: String,   // defaults to ""
    condition:   String,   // NEW | GOOD | FAIR | POOR, default GOOD
    isListed:    Boolean,  // default true  — owner-controlled: published for booking?
    isOnLoan:    Boolean,  // default false — system-controlled: locked by an approved booking
    ownerId:     String,   // user id from the gateway headers (indexed)
    createdAt:   Date,
    updatedAt:   Date
}
```

An item is **bookable** only when `isListed && !isOnLoan`. The two flags are deliberately separate: the owner delisting an item ("I'm using it this week") and the system locking it during a loan must never overwrite each other.

`ownerId` is stored as a **plain string**, not a Mongoose `ObjectId` ref. Users live in another service's database, so a populate across that boundary is impossible by design. The field records who published the item — and drives every ownership check; resolving it to a name means calling user-service.

---

## Auth model

Gateway-trust. `src/middlewares/authMiddleware.js` reads:

```
x-user-id
x-user-role
```

and builds `req.user` from them. It does **not** verify a JWT — only the gateway does that. Missing headers produce a 401 (`"Missing gateway identity headers"`).

Writes are authorized in the service layer: the item is loaded, then `assertCanManage` requires the caller to be the item's owner, a `RESOURCE_MANAGER`, or an `ADMIN`.

### Two kinds of caller

This service is called by two different clients:

1. **Humans, through the gateway** — the gateway sets `x-user-id` / `x-user-role` from their JWT; ownership checks run against that identity.
2. **Booking-service, as a system** — the loan lock (`PATCH /:id/loan`) is driven by the booking lifecycle, where the acting user (e.g. the borrower collecting an approval) is *not* the item's owner. So that route skips user auth entirely and instead requires the `x-internal-secret` header to match `INTERNAL_API_SECRET`. The gateway strips this header from all external requests, so only services holding the secret can reach it.

---

## Validation

Pure functions returning `{ valid, errors }`; the controller joins errors with `", "` and throws a 400.

| Endpoint | Rules |
|---|---|
| Create | `name`, `category`, `department` all required, minimum 2 characters |
| Update | At least one of `name`, `category`, `department`, `description`, `condition` — anything else (notably `ownerId`, `isListed`, `isOnLoan`) is silently stripped |
| Availability | `isListed` must be a strict boolean — `"true"` as a string is rejected |
| Loan | `isOnLoan` must be a strict boolean |

---

## Examples

**Publish an item** (any user)
```bash
curl -X POST http://localhost:3000/api/v1/inventory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Dell Latitude 5420",
        "category": "Laptop",
        "department": "CSE",
        "description": "16GB RAM, i7",
        "condition": "GOOD"
      }'
```

```json
{
    "success": true,
    "message": "Item created",
    "data": {
        "_id": "66b1...",
        "name": "Dell Latitude 5420",
        "category": "Laptop",
        "department": "CSE",
        "description": "16GB RAM, i7",
        "condition": "GOOD",
        "isListed": true,
        "isOnLoan": false,
        "ownerId": "665a...",
        "createdAt": "2026-08-10T12:00:00.000Z",
        "updatedAt": "2026-08-10T12:00:00.000Z"
    }
}
```

**Browse what's free**
```bash
curl "http://localhost:3000/api/v1/inventory?available=true&department=CSE" \
  -H "Authorization: Bearer $TOKEN"
```

**Test directly, bypassing the gateway**
```bash
curl http://localhost:4001/api/v1/inventory \
  -H "x-user-id: 123" -H "x-user-role: ADMIN"
```

---

## Environment variables

```
PORT=4001
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/inventory-service
INTERNAL_API_SECRET=<random-long-string>   # must match booking-service
```

No JWT secret — this service never verifies tokens. No RabbitMQ — it neither publishes nor consumes events. `INTERNAL_API_SECRET` guards the internal `/loan` endpoint.

---

## Running standalone

```bash
cp .env.example .env
# fill in MONGODB_URI
npm install
npm run dev
```

Exits with code 1 if MongoDB is unreachable at startup.

---

## Error responses

```json
{ "success": false, "message": "Item not found" }
```

| Status | When |
|---|---|
| `400` | Validation failed, or `isListed` / `isOnLoan` wasn't a boolean |
| `401` | Missing `x-user-id` / `x-user-role` headers |
| `403` | Not the item's owner (and not manager/admin), or bad/missing internal secret on `/loan` |
| `404` | Item not found |
