# Inventory Service

Owns the item catalog. Resource managers and admins can create, update, delete items. Anyone authenticated can browse.

## Endpoints

- `GET  /api/v1/inventory` — authed. List items (filters: category, available).
- `GET  /api/v1/inventory/:id` — authed. Single item.
- `POST /api/v1/inventory` — manager/admin. Create item.
- `PATCH /api/v1/inventory/:id` — manager/admin. Update item.
- `DELETE /api/v1/inventory/:id` — manager/admin. Delete item.
- `PATCH /api/v1/inventory/:id/availability` — manager/admin OR booking-service. Toggle availability.
- `GET  /health` — health check.

## Auth model

Trusts `x-user-id` and `x-user-role` headers set by the API Gateway. Does not verify JWT.
