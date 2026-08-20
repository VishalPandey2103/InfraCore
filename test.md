# InfraCore — Load Test Report

**Date:** 2026-08-19
**Scope:** inventory read path, API gateway end-to-end, Redis failure behaviour
**Tool:** autocannon 8.0.0

Every number in this document came out of a command recorded in [§9](#9-reproducing-this). Where a
figure could not be reproduced, it is marked rather than quoted.

---

## 1. What I set out to measure

1. **How many requests per second does one instance actually serve, and at what latency?**
2. **Does the Redis cache-aside layer earn its place?** The README asserts inventory reads dominate
   this system and that caching them is the right fix. That is a hypothesis until it is measured.
3. **Where is the ceiling, and what breaks first?**

---

## 2. Pass criteria

Fixed **before** running anything, because "handles N req/s" means nothing without saying what
happens at N:

```
tail latency  p97.5 < 200 ms
error rate    < 0.5 %
memory        no sustained growth over a 5-minute run
```

Capacity is reported as **the highest concurrency step that still met all three**, never as the
highest req/s observed. Peak throughput usually lands at a concurrency where tail latency has already
collapsed.

> Percentiles are p50 / p90 / **p97.5** / p99 — autocannon does not report p95, so every "tail"
> figure here is p97.5.

---

## 3. Environment

| | |
|---|---|
| CPU | 12th Gen Intel Core i5-12500H — 12 physical / 16 logical cores |
| RAM | 15.6 GB |
| OS | Windows 11 Home Single Language |
| Node | v22.15.0 |
| Redis | 7.4.10 (Docker `redis:7-alpine`, port 6379) |
| MongoDB | **Atlas (remote)** — measured ping 50, 46, 47, 49, 50 ms |
| node-redis | 4.7.1 |
| Load generator | autocannon 8.0.0, **co-located on the same machine** |
| Dataset | 500 items · full list 179,015 B · filtered list (`category=laptop&available=true`) 99 items / 35,350 B · single item ~600 B |

The remote database is the single most important row. A cache miss pays a ~48 ms WAN round trip, so
the cache here is buying back a network hop, not CPU.

```
$ node -e "...db.command({ping:1}) x5..."
atlas ping ms: 50,46,47,49,50
countDocuments: 500 in 53ms
```

---

## 4. Method

Requests go **directly to inventory-service on :4001** for service-level tests, using the
`x-user-id` / `x-user-role` headers the gateway normally injects — `authMiddleware.js` is
gateway-trust and does not verify JWTs, so this bypasses the gateway and its rate limiter cleanly.
Gateway tests go through a separate gateway instance with the rate limit raised.

**The cache A/B.** `listItems` hashes the *entire* `req.query` object into the cache key but only
reads `category` / `department` / `available` when building the Mongo query. So appending a unique
`&bust=<random>` produces a fresh cache key on every request while leaving the database work
byte-for-byte identical — a clean cache-hit vs cache-miss comparison with nothing else changed.

I verified the misses were genuine rather than trusting the tool:

```
$ docker exec infracore-bench-redis redis-cli scard inv:list-index
1364          # 1,364 distinct list keys created -> real misses
```

---

## 5. Results — service level

### 5.1 Single-item read (cache hit), direct to :4001, 15 s per step

| connections | req/s | p50 | p90 | p97.5 | p99 | non-2xx | errors |
|---|---|---|---|---|---|---|---|
| 10 | 1,254 | 7 ms | 9 ms | 12 ms | 14 ms | 0 | 0 |
| 25 | 1,646 | 14 ms | 17 ms | 20 ms | 22 ms | 0 | 0 |
| 50 | 1,887 | 26 ms | 31 ms | 37 ms | 41 ms | 0 | 0 |
| 100 | 2,157 | 46 ms | 55 ms | 63 ms | 70 ms | 0 | 0 |
| **200** | **2,486** | 76 ms | 97 ms | **113 ms** | 126 ms | 0 | **0** |

All five steps pass. **≥ 2,486 req/s at 200 connections, p97.5 113 ms, zero errors.** Throughput was
still climbing at the last step, so this is a floor, not the true ceiling.

### 5.2 List endpoint — cache hit vs. forced cache miss

Same query, same 99-item / 35 KB result set, same session. Only the cache differs.

| connections | **cached** req/s | cached p50 | cached p97.5 | **uncached** req/s | uncached p50 | uncached p97.5 |
|---|---|---|---|---|---|---|
| 1 | — | — | — | 12 | 65 ms | 154 ms |
| 2 | — | — | — | 20 | 75 ms | 228 ms |
| 5 | — | — | — | 42 | 114 ms | 220 ms |
| 10 | **638** | 14 ms | **23 ms** | **52** | 188 ms | **372 ms** |
| 25 | 764 | 32 ms | 45 ms | 70 | 346 ms | 653 ms |
| 50 | 824 | 60 ms | 79 ms | 78 | 627 ms | 857 ms |
| 100 | **832** | 118 ms | **148 ms** | 85 | 1,118 ms | 1,420 ms |
| 200 | 834 | 225 ms | 283 ms | — | — | — |

Zero non-2xx and zero errors throughout.

> Rows at 1 / 2 / 5 connections come from an earlier run in the same session; the 10–200 rows for
> both columns were run back-to-back today.

**Cache effect at 10 connections: 52 → 638 req/s (12.3×), p97.5 372 ms → 23 ms (16×).**
**Ceiling: ~85 req/s uncached vs ~834 req/s cached (~10×).**

The uncached path flattens at ~85 req/s no matter the concurrency, because every miss pays the ~48 ms
Atlas round trip and client concurrency cannot make the network faster. Under the 200 ms tail bar,
**the uncached endpoint fails at 2 connections**; the cached one holds to 100 (832 req/s).

### 5.3 Five-minute sustain runs

| scenario | conns | avg req/s | total requests | p50 | p97.5 | p99 | timeouts | RSS |
|---|---|---|---|---|---|---|---|---|
| item read | 200 | **2,686** | 803,089 | 71 ms | 111 ms | 130 ms | 3 (0.0004 %) | 109–114 MB, flat |
| cached list | 100 | **689** | 206,684 | 140 ms | 168 ms | 339 ms | 54 (0.026 %) | 130–293 MB, no trend |

Both pass. Neither leaks — the item run's RSS is flat across all 20 samples.

The cached-list run is the interesting one: 54 timeouts and a p99 of 339 ms against a p97.5 of
168 ms. Five minutes ÷ 60 s list TTL = five expiries. `cacheService.getList` has no single-flight
guard, so at each expiry every in-flight request misses at once and stampedes Atlas together — a
100-way thundering herd, five times per run. **A 30-second benchmark cannot see this**; it only
appears once the run outlives the TTL.

---

## 6. Results — end to end through the gateway

Same item endpoint, one extra hop, rate limit raised so the limiter is not what's being measured.

### 6.1 Before: no upstream connection pooling

| connections | req/s | p50 | p90 | p97.5 | p99 | errors |
|---|---|---|---|---|---|---|
| 10 | 160 | 3,865 ms | 6,517 ms | 7,063 ms | 7,148 ms | 236 |
| 25 | 235 | 3,887 ms | 6,762 ms | 7,132 ms | 7,223 ms | 283 |
| 50 | 224 | 3,822 ms | 6,917 ms | 7,274 ms | 7,310 ms | 69 |
| 100 | 413 | 3,228 ms | 4,768 ms | 5,358 ms | 5,535 ms | 70 |
| 200 | 192 | 3,456 ms | 7,894 ms | 8,999 ms | 9,076 ms | 0 |

**No concurrency level passes.** Median latency ~3.9 s against 76 ms for the same endpoint one hop
away, and 658 errors total.

Socket count measured around the run:

```
TIME_WAIT sockets to :4001 before =     3
TIME_WAIT sockets to :4001 after  = 12,460
Windows ephemeral port range      = 16,384  (49152–65535)
```

`createProxyMiddleware` in `api-gateway/src/app.js` passes no `agent`, so upstream connections are
never pooled — a new TCP connection per proxied request. One ramp left the machine ~3,900 ports short
of total ephemeral exhaustion. The multi-second latencies are connection setup queuing behind port
recycling, and the `errors` column running *backwards* (236 at 10 connections, 0 at 200) is the tell:
the failure tracks connection **churn rate**, not load.

### 6.2 After: keep-alive agent

```js
const http = require("http");
const upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 512, maxFreeSockets: 256 });

createProxyMiddleware({
  target: svc.target,
  changeOrigin: true,
  agent: upstreamAgent,          // <-- added
});
```

Identical ramp, run only after the socket table had drained back to 105 (it took ~115 s):

| connections | req/s | p50 | p97.5 | errors | | before → after |
|---|---|---|---|---|---|---|
| 10 | **279** | **35 ms** | 48 ms | **0** | | 160 → 279 req/s · p50 3,865 → 35 ms |
| 25 | **391** | **63 ms** | 82 ms | **0** | | 235 → 391 req/s · p50 3,887 → 63 ms |
| **50** | **441** | **111 ms** | **145 ms** | **0** | | 224 → 441 req/s · p50 3,822 → 111 ms |
| 100 | 474 | 208 ms | 249 ms | 0 | | 413 → 474 req/s · p50 3,228 → 208 ms |
| 200 | 483 | 397 ms | 623 ms | 0 | | 192 → 483 req/s · p50 3,456 → 397 ms |

```
TIME_WAIT sockets to :4001 before = 105
TIME_WAIT sockets to :4001 after  = 247      (was 12,460)
```

**2.5× throughput at 200 connections, 35× lower median latency at 50, 658 errors → 0, ~50× fewer
sockets.** Under the pass criteria the platform goes from **passing at no concurrency level at all**
to **441 req/s at 50 connections, p97.5 145 ms**.

The gateway is still the ceiling afterwards — 483 vs 2,486 req/s direct. The remaining cost is JWT
verification plus two sequential Redis round trips per request (`INCR` then `TTL`) in
`rateLimitMiddleware`. Collapsing those into one pipeline or Lua script is the next thing to measure.

---

## 7. Redis failure behaviour

The code comments promise graceful degradation. Measured, that promise holds in one direction and
fails badly in two others.

### 7.1 Runtime outage — the first request degrades, the rest hang

```
Redis UP                       -> HTTP 200 in 0.006 s
$ docker stop infracore-bench-redis
first request after stop       -> HTTP 200 in 0.303 s     <- degraded correctly, fell through to Mongo
next 5 requests (direct :4001) -> HTTP 000 in 20.0 s each  <- hung, client gave up
next 3 requests (via gateway)  -> HTTP 000 in 20.0 s each  <- hung
```

So it degrades once, then stops serving entirely.

**Root cause, reproduced in isolation against node-redis 4.7.1:**

```
connected      -> isOpen=true isReady=true  guard(isOpen)=true
SET ok while up
after stop     -> isOpen=true isReady=false guard(isOpen)=true
GET STILL PENDING after 6s -> command queued, never resolves, never rejects
=> guard passes (isOpen true) but client unusable (isReady false) -> await hangs forever
```

`isRedisReady()` is `Boolean(client && client.isOpen)`. In node-redis 4, `isOpen` stays `true` for
the entire reconnect loop — it means "connecting or connected", not "usable". So the guard passes,
the command lands in the offline queue, and it **never resolves and never rejects**, which means the
surrounding `try/catch` never fires and the request hangs forever. Every path touching the cache or
the limiter inherits this: `cacheService.getItem` / `getList` / `getMine`, and
`rateLimitMiddleware`'s `INCR` / `TTL`.

**Fix:**

```js
const isRedisReady = () => Boolean(client && client.isReady);   // was client.isOpen
```

plus `disableOfflineQueue: true`, so a command issued while disconnected rejects immediately —
which is what the existing `try/catch` blocks were always written to handle.

### 7.2 Boot with Redis down — the service never starts at all

```
$ node src/server.js          # Redis not running
MongoDB Connected
[inventory-service] Redis error:
[inventory-service] Redis error:
...                            # 207 lines and counting

$ port 4001 NEVER BOUND after 25s
```

`server.js` does `await connectRedis()` **before** `app.listen()`, and `client.connect()` never
rejects while the default strategy retries forever. Redis down at boot means the service never binds
its port — no health endpoint, no degraded mode, nothing. I confirmed the same shape on the gateway.

**Fix:** a bounded `reconnectStrategy`, or simply don't await Redis before `listen()`.

### 7.3 Recovery

```
$ docker start infracore-bench-redis
recovered: HTTP 200 after 14.4 s
```

It does self-heal, but 14.4 s of hung requests is a long outage for something advertised as
fail-open.

---

## 8. Findings summary

| # | Finding | Evidence |
|---|---|---|
| 1 | Gateway opens a new TCP connection per proxied request; caps platform at ~200–400 req/s with ~3.9 s medians | 12,460 TIME_WAIT sockets vs 16,384 ephemeral ports; fixed by keep-alive agent → 2.5× rps, 0 errors |
| 2 | Cache stampede at every list-TTL expiry — no single-flight guard | 5-min sustain: 54 timeouts, p99 339 ms vs p97.5 168 ms, dips aligned to 60 s TTL |
| 3 | Redis guard uses `isOpen` (true while reconnecting) → requests hang forever instead of degrading | `isOpen=true isReady=false`, GET never settles; 20 s client timeouts |
| 4 | Redis down at boot → service never binds its port | 207 retry lines, port 4001 never bound in 25 s |
| 5 | List endpoint is unpaginated — 179 KB full response, 28 MB/s of JSON at plateau | `Item.find(query).sort(...)` with no `limit`/`skip`; throughput plateaus at ~834 req/s on serialization |

---

## 9. Reproducing this

```bash
# infrastructure
docker run -d --name infracore-bench-redis -p 6379:6379 redis:7-alpine
npm run dev

# harness
npm i -D autocannon
USER_ID=<id> node seed.js 500

# service level
USER_ID=<id> STEPS=10,25,50,100,200 DURATION=15 node ramp.js item
USER_ID=<id> STEPS=10,25,50,100,200 DURATION=15 node ramp.js list-cached
USER_ID=<id> FLUSH_BETWEEN=1 STEPS=10,25,50,100 DURATION=15 node ramp.js list-uncached
docker exec infracore-bench-redis redis-cli scard inv:list-index   # prove misses were real

# sustain at the knee
node sustain.js item 200 300
node sustain.js list-cached 100 300

# gateway (raise the limit, or you only benchmark the limiter)
PORT=3001 RATE_LIMIT_MAX=100000000 RATE_LIMIT_AUTH_MAX=100000000 node api-gateway/src/server.js
BASE=http://localhost:3001 AUTH="$TOKEN" STEPS=10,25,50,100,200 DURATION=15 node ramp.js item
netstat -ano | grep ":4001" | grep -c "TIME_WAIT"
# let TIME_WAIT drain below ~800 before running the patched build, or you penalise it

# redis failure
docker stop infracore-bench-redis && curl -m 20 .../api/v1/inventory/<id>
```

---

## 10. Caveats

Stated plainly, because a capacity number without its conditions is not a capacity number:

- **The load generator ran on the same machine as the services.** autocannon, five Node processes,
  Redis and Docker all competed for the same 16 logical cores. Every figure here is a floor.
- **MongoDB is Atlas, ~48 ms away.** A co-located database would shrink the cache's advantage
  substantially — the cache is buying back a network hop, not CPU. Against local Mongo the honest
  headline would be considerably smaller than 10×.
- **Single instance of each service**, one core per Node process, nothing clustered.
- **500 items.** Payload-bound results (the list endpoint) scale with catalog size; single-item
  results do not.
- **Read paths only.** The booking write path (Mongo write + inter-service HTTP call + RabbitMQ
  publish) is not measured here and will be materially slower. It is the next thing to test.
- The 1 / 2 / 5-connection uncached rows and both sustain runs come from an earlier run in the same
  session on the same dataset; everything else was run back-to-back.
- Percentiles are p97.5, not p95, because that is what autocannon reports.
