# Testing InfraCore with Postman

Manual tests. You type the data, hit Send, and look at the response.

```
tests/
  postman/
    InfraCore.postman_collection.json    every endpoint, one request each
    InfraCore.postman_environment.json   baseUrl + the ids you collect
  scripts/
    bootstrap-admin.js                   creates the first ADMIN
    reset-test-data.js                   wipes test data
```

## Setup (once)

**1. Start everything**

```bash
docker start rabbitmq          # if it is not already running
npm run dev                    # from the project root
```

Wait until you see all five lines:

```
[user]         User Service running on port 4000
[inventory]    Inventory Service running on port 4001
[booking]      Booking Service running on port 4002
[notification] Notification Service running on port 4003
[gateway]      API Gateway running on port 3000
```

Keep this terminal visible. Notifications print here.

**2. Create the admin**

```bash
node tests/scripts/bootstrap-admin.js
```

Gives you `admin@infracore.test` / `Admin@12345`.

You need this script because `register` always creates a STUDENT, and only an
ADMIN can change roles — so the first admin cannot be made through the API.

**3. Import into Postman**

Import → drag in both files from `tests/postman/`. Then pick
**InfraCore - Local** in the environment dropdown, top right. Nothing works
if you skip that.

## How it works

Login saves your token into `{{token}}`, and every request sends it
automatically. **Whoever you logged in as last is who you are.** To switch
users, just run Login again with a different email.

Register and Create item save `{{userId}}` and `{{itemId}}` for you. For
anything else, copy an `_id` out of a response and paste it into the
environment (the eye icon, top right).

> One thing that catches people out: the role lives **inside** the token.
> Promote someone to RESOURCE_MANAGER and nothing changes until they
> **log in again**.

## The walkthrough

Do this in order the first time. It touches all three services and the message queue.

| # | Request | As | What you should see |
|---|---------|-----|---------------------|
| 1 | `0. Health` → Gateway health | — | `success: true` |
| 2 | `1. Auth` → Register | — | 201. Change the email to anything unused |
| 3 | `1. Auth` → Register | — | Register a second person to be the manager |
| 4 | `1. Auth` → Login | admin | Use `admin@infracore.test` / `Admin@12345` |
| 5 | `2. Users` → List all users | admin | Find your manager, copy their `_id` into `{{userId}}` |
| 6 | `2. Users` → Change role | admin | `RESOURCE_MANAGER`. 200 |
| 7 | `1. Auth` → Login | manager | **Required** — this is what activates the new role |
| 8 | `3. Inventory` → Create item | manager | 201, `isAvailable: true`. Saves `{{itemId}}` |
| 9 | `1. Auth` → Login | student | Back to the student |
| 10 | `4. Bookings` → Create booking | student | 201, `PENDING`. Saves `{{bookingId}}` |
| 11 | — | — | **Check your terminal**: `Subject: Booking submitted` |
| 12 | `1. Auth` → Login | manager | |
| 13 | `4. Bookings` → Approve | manager | 200, `APPROVED` |
| 14 | `3. Inventory` → Get item by id | manager | `isAvailable` is now **false** |
| 15 | `4. Bookings` → Mark returned | manager | 200, `RETURNED` |
| 16 | `3. Inventory` → Get item by id | manager | `isAvailable` is **true** again |

Steps 13–14 are the interesting pair: booking-service reached across to
inventory-service over HTTP to flip that flag. Step 11 is the other half —
that message went out through RabbitMQ to a completely separate process.

## Checking the queue

The notification service is not in the HTTP path, so Postman cannot see it.
Two ways to confirm it worked:

- **Your terminal** — look for the `[notification]` block after any booking action
- **http://localhost:15672** (guest / guest) → Queues → `notification.bookings`

If bookings succeed but no notification appears, the message was published and
dropped. Check the bindings on the `infracore.events` exchange.

## Things that should fail

Folder `5. Things that should fail` is worth running once. It confirms the
gateway rejects missing tokens, junk tokens, and — importantly — **forged
`x-user-role: ADMIN` headers**.

That last one matters. The services themselves do no JWT checking; they just
trust `x-user-id` and `x-user-role`, and the gateway strips whatever the client
sent. Send those same headers straight to `http://localhost:4001` and you get
admin access with no token at all. That is by design, but it means **ports
4000–4002 must never be publicly reachable**.

## Role reference

| | STUDENT | RESOURCE_MANAGER | ADMIN |
|---|:---:|:---:|:---:|
| Read inventory | ✅ | ✅ | ✅ |
| Create / edit / delete items | ❌ | ✅ | ✅ |
| Create a booking | ✅ | ❌ | ❌ |
| Cancel own booking | ✅ | ❌ | ❌ |
| Approve / reject / return | ❌ | ✅ | ✅ |
| See all bookings | ❌ | ✅ | ✅ |
| List users, change roles | ❌ | ❌ | ✅ |

Note that booking is STUDENT-only, so an admin cannot create one.

## Booking states

```
PENDING ──approve──> APPROVED ──return──> RETURNED
   │
   ├──reject──> REJECTED
   └──cancel──> CANCELLED
```

`REJECTED`, `CANCELLED` and `RETURNED` are final. Anything else is a
400 `Cannot transition from X to Y`.

## Starting over

```bash
node tests/scripts/reset-test-data.js --yes
```

Deletes all bookings, all items, and all users except the admin. It will not
run without `--yes`.
