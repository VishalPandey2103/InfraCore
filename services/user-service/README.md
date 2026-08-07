# User Service

Owns identity: register, login, JWT issuance, user profile CRUD, RBAC roles.

## Endpoints

- `POST /api/v1/auth/register` — public. Creates a STUDENT.
- `POST /api/v1/auth/login` — public. Returns JWT.
- `GET  /api/v1/users/me` — authed. Current user's profile.
- `GET  /api/v1/users` — admin only. List all users.
- `GET  /api/v1/users/:id` — admin or self.
- `PATCH /api/v1/users/me` — authed. Update own profile.
- `PATCH /api/v1/users/:id/role` — admin only. Change a user's role.
- `GET  /health` — health check.

## Roles

`STUDENT` (default), `RESOURCE_MANAGER`, `ADMIN`.

## Running standalone

```bash
cp .env.example .env
# fill in MONGODB_URI and JWT_SECRET
npm install
npm run dev
```
