# Booking Service

Owns the borrowing state machine.

## States

`PENDING` → `APPROVED` → `RETURNED`
`PENDING` → `REJECTED`
`PENDING` → `CANCELLED`

## Endpoints

- `POST   /api/v1/bookings` — student. Create a booking (checks inventory availability first).
- `GET    /api/v1/bookings/me` — student. Own bookings.
- `GET    /api/v1/bookings` — manager/admin. All bookings.
- `GET    /api/v1/bookings/:id` — student (own) or manager/admin.
- `PATCH  /api/v1/bookings/:id/approve` — manager/admin.
- `PATCH  /api/v1/bookings/:id/reject` — manager/admin.
- `PATCH  /api/v1/bookings/:id/cancel` — student (own only).
- `PATCH  /api/v1/bookings/:id/return` — manager/admin.
- `GET    /health` — health check.

## Events published

To exchange `infracore.events` on RabbitMQ:

- `BOOKING_CREATED`
- `BOOKING_APPROVED`
- `BOOKING_REJECTED`
- `BOOKING_CANCELLED`
- `BOOKING_RETURNED`

## Inter-service call

Calls Inventory Service synchronously on booking creation to check availability, and on state changes to flip the item's `isAvailable` flag.
