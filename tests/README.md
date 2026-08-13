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

Register and Publish item save `{{userId}}` and `{{itemId}}` for you. For
anything else, copy an `_id` out of a response and paste it into the
environment (the eye icon, top right).

> One thing that catches people out: the role lives **inside** the token.
> Promote someone to RESOURCE_MANAGER and nothing changes until they
> **log in again**.

## The walkthrough

Do this in order the first time. It touches all three services and the message
queue. You play two ordinary users: the **owner** (publishes the item) and the
**borrower** (books it). No manager or admin needed.

| # | Request | As | What you should see |
|---|---------|-----|---------------------|
| 1 | `0. Health` → Gateway health | — | `success: true` |
| 2 | `1. Auth` → Register | — | 201. This is the **owner**. Change the email to anything unused |
| 3 | `1. Auth` → Register | — | Register a second person — the **borrower** |
| 4 | `1. Auth` → Login | owner | |
| 5 | `3. Inventory` → Publish item | owner | 201, `isListed: true`, `isOnLoan: false`. Saves `{{itemId}}` |
| 6 | `1. Auth` → Login | borrower | |
| 7 | `4. Bookings` → Create booking | borrower | 201, `PENDING`. Saves `{{bookingId}}` |
| 8 | — | — | **Check your terminal**: two notifications — one to the borrower, one to the owner |
| 9 | `1. Auth` → Login | owner | Back to the owner |
| 10 | `4. Bookings` → Requests on my items | owner | The pending booking is in your inbox |
| 11 | `4. Bookings` → Approve | owner | 200, `APPROVED` |
| 12 | `3. Inventory` → Get item by id | owner | `isOnLoan` is now **true** |
| 13 | `4. Bookings` → Mark returned | owner | 200, `RETURNED` |
| 14 | `3. Inventory` → Get item by id | owner | `isOnLoan` is **false** again |
| 15 | `3. Inventory` → List/delist item | owner | Set `isListed: false` — the item can no longer be booked |

Steps 11–12 are the interesting pair: booking-service reached across to
inventory-service over HTTP (authenticated with the internal shared secret)
to flip that flag. Step 8 is the other half — those messages went out through
RabbitMQ to a completely separate process.

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

## Permission reference

Ownership comes first: whoever publishes an item controls it and the booking
requests on it. Roles add moderation powers on top.

| | any user | item owner | RESOURCE_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Read inventory | ✅ | ✅ | ✅ | ✅ |
| Publish an item | ✅ | — | ✅ | ✅ |
| Edit / delete / delist an item | ❌ | ✅ own | ✅ any | ✅ any |
| Book an item | ✅ not own | ❌ own | ✅ | ✅ |
| Cancel own booking | ✅ | — | — | ✅ any |
| Approve / reject / return | ❌ | ✅ own items | ❌ | ✅ any |
| See requests on own items | ✅ | ✅ | ✅ | ✅ |
| See all bookings | ❌ | ❌ | ✅ | ✅ |
| List users, change roles | ❌ | ❌ | ❌ | ✅ |

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
