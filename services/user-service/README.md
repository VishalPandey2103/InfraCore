# User Service

Owns identity for the whole platform: registration, login, JWT issuance, user profiles, and role assignment. It is the only service that hashes passwords and the only one that signs tokens.

Runs on port **4000**, backed by the `user-service` database.

---

## Endpoints

All paths are shown as they appear at the gateway. Reaching this service directly uses the same paths on port 4000.

### Auth — public

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/auth/register` | `{ name, email, password }` |
| `POST` | `/api/v1/auth/login` | `{ email, password }` |

Both return the same shape — a sanitized user plus a signed token:

```json
{
    "success": true,
    "message": "Login successful",
    "data": {
        "user": { "id": "665a...", "name": "Vishal", "email": "vishal@test.com", "role": "STUDENT" },
        "token": "eyJhbGciOiJIUzI1NiIs..."
    }
}
```

The password hash is never included in any response — the service builds an explicit object rather than returning the Mongoose document.

### Users — authenticated

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/v1/users/me` | any authed user | Current user's profile |
| `PATCH` | `/api/v1/users/me` | self | Update own `name` and/or `email` |
| `GET` | `/api/v1/users` | `ADMIN` | List all users |
| `GET` | `/api/v1/users/:id` | self or `ADMIN` | Fetch a single user |
| `PATCH` | `/api/v1/users/:id/role` | `ADMIN` | Change a user's role |

Every read excludes the password field via `.select("-password")`.

### Health

| Method | Path |
|---|---|
| `GET` | `/health` |

---

## Data model

```js
{
    name:      String,   // required, trimmed
    email:     String,   // required, unique, lowercased, trimmed
    password:  String,   // required — bcrypt hash, never the plaintext
    role:      String,   // STUDENT | RESOURCE_MANAGER | ADMIN, default STUDENT
    createdAt: Date,
    updatedAt: Date
}
```

`email` carries a unique index. A duplicate registration is caught explicitly by the service and returned as a 409 rather than surfacing as a Mongo error.

---

## Auth model

Like every other downstream service, user-service trusts the `x-user-id` / `x-user-role` headers set by the gateway. `src/middlewares/authMiddleware.js` does **not** verify the JWT.

Signing and verifying are separate concerns, and this service only does the first:

| | Where |
|---|---|
| **Signs** tokens at login | here — it owns `JWT_SECRET` |
| **Verifies** tokens on each request | the gateway, and only the gateway |

This service originally did verify its own tokens, on the reasoning that it already had the secret. That broke every `/api/v1/users/*` route: the gateway deliberately strips the `Authorization` header before proxying, so the header this middleware was reading never arrived, and every request came back 401. Calling port 4000 directly worked fine, which made it look like a gateway bug.

Calling this service directly during development therefore needs the identity headers, not a token:

```bash
curl http://localhost:4000/api/v1/users/me \
  -H "x-user-id: 665a..." -H "x-user-role: STUDENT"
```

`roleMiddleware` is variadic and composes on top:

```js
router.get("/", auth, role("ADMIN"), listUsers);
```

Ownership checks that can't be expressed as a role live in the controller — `getUserById` allows the request when the caller is an `ADMIN` *or* the ID matches their own.

---

## Validation

Validators are pure functions returning `{ valid, errors }`. The controller throws a 400 with the errors joined by `", "`.

| Rule | Applies to |
|---|---|
| Name at least 2 characters | register, profile update |
| Valid email format (`validator.isEmail`) | register, login, profile update |
| Password at least 8 characters | register |
| At least one of `name` / `email` supplied | profile update |
| Role must be one of the three enum values | role change |

---

## Roles

| Role | Meaning |
|---|---|
| `STUDENT` | Default on registration. Borrows items. |
| `RESOURCE_MANAGER` | Manages the catalog and approves bookings. |
| `ADMIN` | Full access, including user management. |

`register` hard-codes `role: "STUDENT"` rather than reading it from the request body, so the role cannot be escalated at signup.

### Creating the first admin

`register` always creates a `STUDENT` and only an `ADMIN` can change roles, so the first admin cannot be created through the API — run `node tests/scripts/bootstrap-admin.js` from the project root, which writes it straight to the database. By hand: register through the API, open the `user-service` database in Atlas, and set that user's `role` to `"ADMIN"`.

Either way, **log in again** — the role is embedded in the JWT when it's signed, so an existing token still carries the old value.

After that, admins promote others through `PATCH /api/v1/users/:id/role`.

---

## Tokens

Signed with `jsonwebtoken` using `JWT_SECRET`, expiring after `JWT_EXPIRES_IN` (default `7d`). The payload is deliberately minimal:

```json
{ "id": "<user id>", "role": "<role>", "iat": ..., "exp": ... }
```

Those two claims are exactly what the gateway forwards downstream as `x-user-id` and `x-user-role`.

Because the role travels inside the token, a role change doesn't take effect until the user logs in again.

---

## Environment variables

```
PORT=4000
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/user-service
JWT_SECRET=change-this-to-a-long-random-string
JWT_EXPIRES_IN=7d
```

> `JWT_SECRET` must match `api-gateway/.env` exactly.

Generate one with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Every variable is read once in `src/config/envConfig.js`; no other module touches `process.env`.

---

## Running standalone

```bash
cp .env.example .env
# fill in MONGODB_URI and JWT_SECRET
npm install
npm run dev
```

If MongoDB is unreachable the process logs the failure and exits with code 1 rather than serving requests it can't fulfil.

---

## Error responses

```json
{ "success": false, "message": "Invalid email or password" }
```

| Status | When |
|---|---|
| `400` | Validation failed |
| `401` | Bad credentials, or missing/invalid/expired token |
| `403` | Authenticated, but not permitted (wrong role, or another user's resource) |
| `404` | User not found |
| `409` | Email already registered |

Login returns the same `"Invalid email or password"` for both an unknown email and a wrong password — the response doesn't reveal which accounts exist.
