# ⚡ Vitals — Distributed Background Task Processing Platform

Fault-tolerant background job processing with multi-worker dispatch, heartbeat-based failure detection, automatic task recovery and reassignment, retries with Dead-Letter Queue, scheduled jobs, and a real-time WebSocket dashboard.

**The headline demo:** kill a worker mid-task and watch the system detect the failure, recover the task, reassign it, and complete it — in about 9 seconds, fully observable in the dashboard.

---

## Quickstart

```bash
pnpm install          # embedded-postgres + esbuild build scripts are pre-approved
pnpm dev              # boots API + dashboard + embedded Postgres + 2 demo workers
```

- Dashboard: http://localhost:8080
- API: http://localhost:8080/api/health
- Data dir: `.data/pg` (persisted across restarts; safe to delete for a fresh start)

Requires Node 20+. No Docker, no external Postgres needed — the server boots an
embedded PostgreSQL automatically (or set `DATABASE_URL` to use your own).

Run additional standalone workers (each is an independent process):

```bash
pnpm worker -- --name worker-2 --capacity 4
```

## The failure → recovery demo

1. Open http://localhost:8080 → **Demo** tab → click **Run failure→recovery demo**.
   It resets the system, spawns 3 chaos workers, seeds 24 deterministic tasks
   (seed=42, same mix every run), and waits.
2. One of the tasks is `demo.crash`: when a worker runs it, the worker **hard-exits
   (SIGKILL-style) mid-task** with the task still marked RUNNING.
3. Watch the chain complete automatically:
   - **FAILURE DETECTION** — heartbeats stop; after 5s the worker is marked offline
   - **TASK RECOVERY** — after 7s the lease expires; the reaper requeues the task
   - **REASSIGNMENT** — a healthy worker claims it (attempt counter unchanged: worker death ≠ task failure)
   - **SUCCESSFUL EXECUTION** — the task completes
4. The **Workers** tab offers manual chaos: Pause heartbeats / Resume / Kill (SIGKILL) / Add worker.
   The **DLQ** tab inspects exhausted tasks and reprocesses them (singly or in bulk).

CLI alternative: `pnpm demo:scenario` runs the same flow headless and asserts
kill → recovery → completion within the SLO (verified 3/3 runs, ~9s each).

## Task lifecycle

```
SCHEDULED ─(due)→ PENDING ─(claim, attempt+1)→ RUNNING ─→ COMPLETED
                     ▲                          │ handler throws (attempt < max)
                     │                          ▼
                     └────────(backoff due)── RETRYING ─(attempt ≥ max)→ DEAD_LETTER
                                                                      (manual /retry → PENDING)

worker death (not a task failure):
RUNNING ─(lease expires)→ PENDING (attempt unchanged) → claimed by another worker
```

- **Claiming** is a single atomic `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED …)` — a task is leased to exactly one worker.
- **Leases**: each claim sets a fresh `lease_token`; completion/failure/heartbeat-extension must present it. After a recovery, stale acks are rejected with 409 — no zombie writes.
- **At-least-once, honestly**: a task that crashes mid-run may briefly run twice (the crash↔recovery window). Exactly-once is impossible without idempotency keys on the handler side; we say so and provide the fences above.
- **Retries**: exponential backoff, 1s → 2s → 4s … capped at 30s, `maxAttempts` per task (default 3).
- **Scheduled jobs**: pass `scheduledAt` in the future; the task starts as SCHEDULED and is promoted to the active queue when due.

## Architecture

```
┌────────────────────────── apps/server ──────────────────────────┐
│  REST API (Fastify)   Scheduler   Reaper   WS hub   Chaos ctrl  │
│        │                 │         │        │         │        │
│        ▼                 ▼         ▼        ▼         ▼        │
│   TasksRepo / WorkersRepo / EventsRepo / MetricsRepo (atomic SQL)│
└────────┬────────────────────────────────────────────────────────┘
         ▼
   PostgreSQL  (tasks · workers · task_events)   ◄── embedded bootstrap
         ▲
   ┌─────┴──────┬─────────────┐
 worker ×N (claim loop · heartbeat loop · fenced acks · handlers)
```

- **Queue = Postgres**, using `FOR UPDATE SKIP LOCKED` (same pattern production job systems use). One durable store; no Redis required. `packages/core` keeps the domain contract clean enough to swap a Redis-backed queue in later.
- **Failure detection** is lease-based: the reaper never consults worker state to recover tasks; it simply requeues rows whose `lease_expires_at < now()`. Worker OFFLINE status is observability.
- **Events**: every transition writes a `task_events` row (CREATED, LEASED, COMPLETED, FAILED, RETRY_QUEUED, DEAD_LETTER, RECOVERED, WORKER_TIMEOUT…), streamed to the dashboard over WebSocket.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/tasks` | Create task: `{ type, payload?, maxAttempts?, scheduledAt?, priority? }` |
| GET | `/api/tasks?status=&limit=` | List tasks |
| GET | `/api/tasks/:id` | Task detail |
| POST | `/api/tasks/:id/retry` | Reprocess a DLQ task |
| POST | `/api/tasks/claim` | Worker claim: `{ workerId, batch }` |
| POST | `/api/tasks/:id/complete` | Fenced completion: `{ workerId, leaseToken, result? }` |
| POST | `/api/tasks/:id/fail` | Fenced failure: `{ workerId, leaseToken, error }` |
| POST | `/api/workers` | Register: `{ name, capacity?, metadata? }` |
| POST | `/api/workers/:id/heartbeat` | Heartbeat: `{ leases: [{ taskId, leaseToken }] }` |
| POST | `/api/workers/:id/shutdown` | Graceful shutdown (releases tasks) |
| GET | `/api/workers` / `/api/workers/:id` | Worker health |
| GET | `/api/queue` | Queue depth snapshot |
| GET | `/api/metrics` | System metrics |
| WS | `/ws` | Live snapshot + deltas |
| POST | `/api/admin/chaos/*` | Demo kit: spawn/kill/pause workers, seed-tasks, reset |
| GET | `/api/health` | Liveness |

Quick examples:

```bash
# create a task
curl -X POST localhost:8080/api/tasks -H 'content-type: application/json' \
  -d '{"type":"demo.echo","payload":{"hello":"world"}}'

# schedule a task for 1 minute out
curl -X POST localhost:8080/api/tasks -H 'content-type: application/json' \
  -d '{"type":"demo.echo","scheduledAt":"'$(date -u -d '+1 min' +%Y-%m-%dT%H:%M:%SZ)'"}'

# metrics
curl localhost:8080/api/metrics
```

## Demo handlers

| Type | Behavior |
|---|---|
| `demo.echo` | Succeeds, echoes payload |
| `demo.sleep` | Sleeps `workMs` (default 1s) |
| `demo.fail_until_attempt` | Fails while `attempt ≤ failUntilAttempt`, then succeeds — the retry demo |
| `demo.always_fail` | Always fails — the DLQ demo |
| `demo.crash` | **Hard-exits the worker process** on `crashOnAttempt` — the failure demo |

## Timing knobs

| Env | Default | Meaning |
|---|---|---|
| `HEARTBEAT_INTERVAL_MS` | 1500 | Worker heartbeat cadence (independent of task execution) |
| `HEARTBEAT_TIMEOUT_MS` | 5000 | No beat for this long → worker marked OFFLINE |
| `LEASE_TIMEOUT_MS` | 7000 | No renewal for this long → task requeued by reaper |
| `REAPER_INTERVAL_MS` | 1000 | Recovery sweep cadence |
| `CLAIM_POLL_MS` | 400 | Idle worker pickup latency |

Kill → detected (5s) → recovered (7s) → reassigned → completed ≈ **9s** end-to-end.

## Building blocks

```bash
pnpm build          # compile all workspaces
pnpm typecheck      # tsc across server/worker/core
pnpm test           # vitest: lifecycle, fencing, atomic claims, recovery, ws, handlers
pnpm demo:reset     # wipe state, respawn 2 workers
pnpm dev            # run the whole thing
```

## Dashboard

Five live views (WebSocket with automatic polling fallback):

- **Overview** — queue depth, running, completions, DLQ, retries, recoveries, throughput, event feed
- **Workers** — health grid, capacity bars, heartbeat age, chaos controls
- **Tasks** — filterable live table + detail drawer with full lifecycle timeline
- **DLQ** — failed task inspection with reprocess / reprocess-all
- **Demo** — one-click guided failure→recovery scenario with live chain checklist

See `TROUBLESHOOTING.md` for the one-line fix to every common failure.
