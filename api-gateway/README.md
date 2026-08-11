# API Gateway

The single public entry point. Every client request enters here; nothing else in the system should be reachable from outside.

Runs on port **3000**.

---

## What it does

For each incoming request, in order:

1. **Verify the JWT** — required for every prefix except `/api/v1/auth/*` and `/health`.
2. **Decode it** onto `req.user = { id, role }`.
3. **Inject identity headers** — `x-user-id` and `x-user-role` — on the outgoing proxied request.
4. **Strip the `Authorization` header** before forwarding, so the raw token never leaves the perimeter.
5. **Restore the path prefix** that Express strips when middleware is mounted on a path.
6. **Proxy** to the right service based on the URL prefix.

```
Client ──Bearer JWT──▶ Gateway ──x-user-id / x-user-role──▶ Service
                          │
                          └── Authorization header removed here
```

---

## Routing table

Defined in `src/config/servicesConfig.js`:

| Prefix | Target | JWT required |
|---|---|---|
| `/api/v1/auth` | User Service `:4000` | no — `public: true` |
| `/api/v1/users` | User Service `:4000` | yes |
| `/api/v1/inventory` | Inventory Service `:4001` | yes |
| `/api/v1/bookings` | Booking Service `:4002` | yes |

Adding a service means appending one row to that table. `app.js` loops over it and wires each entry identically.

### The path rewrite

The full path reaches the service unchanged — `POST /api/v1/bookings` arrives at booking-service as `POST /api/v1/bookings` — but that takes an explicit step to achieve, not zero steps.

Mounting middleware with `app.use("/api/v1/bookings", proxy)` makes Express **strip the mount prefix** from `req.url`. The proxy would otherwise forward just `/`, and the services mount their routers at the full `/api/v1/...` path, so nothing would match:

```js
pathRewrite: (path) => `${svc.prefix}${path}`,
```

Leave this out and *every* proxied request returns `404 Route not found`, while calling the same endpoint directly on port 4000/4001/4002 works perfectly. The gateway looks healthy, the service looks healthy, and the 404 comes from the service's own notFound middleware — so it reads like a routing typo rather than a stripped prefix.

---

## Auth model

`src/middlewares/jwtMiddleware.js` is the only place in the entire system that calls `jwt.verify()` for request authentication.

```js
Authorization: Bearer <token>
        │
        ├── missing / malformed  →  401 "Missing or invalid Authorization header"
        ├── invalid / expired    →  401 "Invalid or expired token"
        └── valid                →  req.user = { id, role }  →  next()
```

Downstream services never see the token. All three read `x-user-id` and `x-user-role` and trust them — see their gateway-trust `authMiddleware`. That trust is only safe because downstream ports are not publicly reachable; in production this boundary would be enforced at the network layer.

On a protected prefix, a client that sends its own `x-user-role: ADMIN` gains nothing: `verifyJwt` either rejects the request outright, or it runs first and the `proxyReq` hook overwrites both headers with the values decoded from the token. Sending those same headers straight to port 4001 works completely, though — which is the whole reason the service ports must stay private.

One detail to keep in mind if you extend the routing table: the hook only sets the headers `if (req.user)`, and `req.user` is never populated on a `public: true` prefix. Client-supplied identity headers therefore pass through untouched on `/api/v1/auth/*`. That is harmless today because `register` and `login` don't read them — but it stops being harmless the moment an authenticated route is added under a public prefix.

The gateway does **not** do role checks. It establishes *who you are*; each service decides *what you may do*.

---

## Why there is no `express.json()`

Deliberately absent. Calling `express.json()` consumes the request stream while parsing the body, and the proxied request would then arrive downstream empty or hang waiting for data that was already read.

The gateway forwards bytes; it does not inspect them. Do not add body parsing here.

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — not proxied, no auth |

Everything else is proxied. An unmatched path falls through to the notFound middleware and returns a 404 in the standard shape.

---

## Environment variables

```
PORT=3000
JWT_SECRET=<same value as user-service>
USER_SERVICE_URL=http://localhost:4000
INVENTORY_SERVICE_URL=http://localhost:4001
BOOKING_SERVICE_URL=http://localhost:4002
```

> `JWT_SECRET` **must** be byte-identical to the one in `services/user-service/.env`. User-service signs; the gateway verifies. A mismatch turns every authenticated request into a 401.

All three service URLs have localhost defaults in `envConfig.js`, so they're optional for local development.

---

## Running standalone

```bash
cp .env.example .env
# set JWT_SECRET to match user-service
npm install
npm run dev
```

The gateway starts regardless of whether its downstream targets are up — it doesn't health-check them. Requests to a prefix whose service is down fail with a connection error at proxy time.

---

## Error responses

The gateway's own errors use the same envelope as every service:

```json
{ "success": false, "message": "Invalid or expired token" }
```

Responses proxied from downstream services pass through untouched.

Note that the gateway has no `AppError` class — its middlewares respond with `res.status(...).json(...)` directly. The error middleware still reads `err.statusCode` defensively so proxy-layer failures surface in the standard shape.

---

## Testing the trust boundary

Confirm the gateway is actually injecting headers by bypassing it. This call fails:

```bash
curl http://localhost:4001/api/v1/inventory
# 401 "Missing gateway identity headers"
```

This one succeeds, because you supplied what the gateway would have:

```bash
curl http://localhost:4001/api/v1/inventory \
  -H "x-user-id: 123" -H "x-user-role: ADMIN"
```

And through the gateway, the token alone is enough:

```bash
curl http://localhost:3000/api/v1/inventory \
  -H "Authorization: Bearer $TOKEN"
```
