# API Gateway

Single entry point for all clients. Runs on port 3000.

## What it does

1. Verifies JWT for every request except `/api/v1/auth/*` and `/health`.
2. Puts `{ id, role }` on `req.user` from the decoded token.
3. Injects `x-user-id` and `x-user-role` headers on the outgoing proxied request.
4. Strips the incoming `Authorization` header before forwarding.
5. Routes based on URL prefix:
   - `/api/v1/auth/*`, `/api/v1/users/*` → User Service (:4000)
   - `/api/v1/inventory/*` → Inventory Service (:4001)
   - `/api/v1/bookings/*` → Booking Service (:4002)

## Health

`GET /health`
