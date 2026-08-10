# Inventory Service

Owns the item catalog — the physical assets that can be borrowed. Resource managers and admins maintain it; any authenticated user can browse it.

Runs on port **4001**, backed by the `inventory-service` database.

This service also acts as the availability authority: booking-service calls it synchronously to check whether an item can be booked, and to lock or release it as bookings move through their lifecycle.

---

## Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/v1/inventory` | any authed user | List items, with filters |
| `GET` | `/api/v1/inventory/:id` | any authed user | Fetch a single item |
| `POST` | `/api/v1/inventory` | `RESOURCE_MANAGER`, `ADMIN` | Create an item |
| `PATCH` | `/api/v1/inventory/:id` | `RESOURCE_MANAGER`, `ADMIN` | Update an item |
| `DELETE` | `/api/v1/inventory/:id` | `RESOURCE_MANAGER`, `ADMIN` | Delete an item |
| `PATCH` | `/api/v1/inventory/:id/availability` | `RESOURCE_MANAGER`, `ADMIN` | Toggle availability |
| `GET` | `/health` | public | Liveness check |

### Filters

`GET /api/v1/inventory` accepts three optional query parameters:

| Parameter | Example | Behaviour |
|---|---|---|
| `category` | `?category=Laptop` | Exact match |
| `department` | `?department=CSE` | Exact match |
| `available` | `?available=true` | Compared as a string — `"true"` or `"false"` |

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
    isAvailable: Boolean,  // default true
    createdBy:   String,   // user id from the gateway headers
    createdAt:   Date,
    updatedAt:   Date
}
```

`createdBy` is stored as a **plain string**, not a Mongoose `ObjectId` ref. Users live in another service's database, so a populate across that boundary is impossible by design. The field records who added the item; resolving it to a name means calling user-service.

---

## Auth model

Gateway-trust. `src/middlewares/authMiddleware.js` reads:

```
x-user-id
x-user-role
```

and builds `req.user` from them. It does **not** verify a JWT — only the gateway does that. Missing headers produce a 401 (`"Missing gateway identity headers"`).

`roleMiddleware` is variadic and stacks on top:

```js
router.post("/", auth, role("RESOURCE_MANAGER", "ADMIN"), createItem);
```

Reads require authentication but no particular role. All four writes require manager or admin.

### Two kinds of caller

This service is called by two different clients, and both arrive the same way:

1. **Humans, through the gateway** — the gateway sets the headers from their JWT.
2. **Booking-service, directly** — `inventoryClient.js` forwards the *original caller's* `x-user-id` and `x-user-role` on its outbound axios request.

Because booking-service forwards the caller's real role rather than a service identity, a student-initiated action that needs to touch `/availability` will be rejected with a 403. In practice this only affects paths that don't lock or release items anyway — locking happens on approve and releasing on return, both manager/admin actions.

---

## Validation

Pure functions returning `{ valid, errors }`; the controller joins errors with `", "` and throws a 400.

| Endpoint | Rules |
|---|---|
| Create | `name`, `category`, `department` all required, minimum 2 characters |
| Update | At least one of `name`, `category`, `department`, `description`, `condition` |
| Availability | `isAvailable` must be a strict boolean — `"true"` as a string is rejected |

---

## Examples

**Create an item**
```bash
curl -X POST http://localhost:3000/api/v1/inventory \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
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
        "isAvailable": true,
        "createdBy": "665a...",
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
```

That's all. No JWT secret — this service never verifies tokens. No RabbitMQ — it neither publishes nor consumes events.

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
| `400` | Validation failed, or `isAvailable` wasn't a boolean |
| `401` | Missing `x-user-id` / `x-user-role` headers |
| `403` | Authenticated, but the role isn't manager or admin |
| `404` | Item not found |
