# Vitals — API Contract

Base URL: `http://localhost:8080` (configurable via `PORT`).

All request and response bodies are JSON. All timestamps are ISO-8601 UTC strings.

---

## Core concepts

- **Task** — a unit of work. Lifecycle:
  `scheduled → pending → running → completed`
  or `running → retrying → running → …` and, after `maxAttempts` failures, `retrying → dead_letter`.
- **Worker** — a process that claims and executes tasks. Sends heartbeats; if the heartbeat times out, the server marks it `offline` and recovers its leased tasks.
- **Lease** — when a worker claims a task it receives a `leaseToken`. Only the holder of `(taskId, workerId, leaseToken)` can complete/fail/extend the task. Stale holders are fenced out (HTTP 409).

---

## Types

```ts
type TaskStatus = 'scheduled' | 'pending' | 'running' | 'retrying' | 'completed' | 'dead_letter';

interface Task {
  id: string;                          // uuid
  type: string;                        // e.g. "demo.sleep"
  status: TaskStatus;
  priority: number;                    // higher = claimed first
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  assignedWorkerId: string | null;     // null when unassigned
  attempt: number;                     // starts at 1 after first claim
  maxAttempts: number;
  runAt: string;                       // earliest execution time
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Worker {
  id: string;                          // uuid
  name: string;                        // unique, e.g. "worker-1"
  status: 'online' | 'offline';
  capacity: number;                    // max concurrent tasks
  lastHeartbeatAt: string;
  registeredAt: string;
  offlineAt: string | null;
  metadata: Record<string, unknown>;   // e.g. { pid }
}

interface TaskEvent {
  id: number;
  taskId: string | null;
  workerId: string | null;
  type: EventType;
  detail: Record<string, unknown>;
  createdAt: string;
}

type EventType =
  | 'CREATED'
  | 'LEASED'
  | 'COMPLETED'
  | 'RETRY_QUEUED'
  | 'RETRY_NOW'
  | 'DEAD_LETTER'
  | 'RECOVERED'
  | 'WORKER_TIMEOUT'
  | 'WORKER_REGISTERED';

interface MetricsSnapshot {
  ts: string;
  byStatus: Record<TaskStatus, number>;
  workers: { online: number; offline: number };
  completedTotal: number;
  failedTotal: number;
  retriedTotal: number;
  recoveredTotal: number;
  dlqSize: number;
  throughputPerMin: number;            // completions in the last 60s
  successRatePct: number | null;       // null when no terminal tasks yet
}

interface QueueSnapshot {
  byStatus: Record<TaskStatus, number>;
  oldestPendingSeconds: number | null; // age of oldest pending/retrying task
  running: number;
  runningByWorker: Record<string /* workerId */, number>;
}
```

---

## REST API

### Health

```
GET /api/health
→ 200 { "ok": true, "ts": "2026-09-17T17:43:54.306Z" }
```

### Tasks

**Create a task**

```
POST /api/tasks
{
  "type": "demo.sleep",              // required, string ≤200 chars
  "payload": { "workMs": 60000 },    // optional object, default {}
  "maxAttempts": 3,                  // optional int 1..50
  "scheduledAt": "2026-01-01T12:00:00Z", // optional ISO date; task stays 'scheduled' until then
  "priority": 0                      // optional int; higher claims first
}
→ 201 Task
→ 400 { "error": "type (string) is required" }
```

**List tasks**

```
GET /api/tasks?status=running&workerId=<uuid>&limit=100
→ 200 Task[]            // newest first, limit 1..1000, default 100
```

**Get task with its events**

```
GET /api/tasks/:id
→ 200 { "task": Task, "events": TaskEvent[] }   // events newest-first for this task
→ 404 { "error": "task not found" }
```

**Retry a dead-lettered task** (manual DLQ reprocess; attempt counter resets)

```
POST /api/tasks/:id/retry
→ 200 Task
→ 409 { "error": "task not in dead_letter state" }
```

**Claim tasks** (workers only)

```
POST /api/tasks/claim
{ "workerId": "<uuid>", "batch": 1 }   // batch 1..10, default 1
→ 200 { "tasks": Task[] }               // 0..n tasks, atomically leased
```

**Complete a task** (fenced)

```
POST /api/tasks/:id/complete
{ "workerId": "<uuid>", "leaseToken": "<token>", "result": {} }
→ 200 Task
→ 409 { "error": "fence rejected: task moved on" }
```

**Fail a task** (fenced; enqueues retry if attempts remain, else dead-letters)

```
POST /api/tasks/:id/fail
{ "workerId": "<uuid>", "leaseToken": "<token>", "error": "reason" }
→ 200 Task
→ 409 { "error": "fence rejected: task moved on" }
```

### Workers

**Register**

```
POST /api/workers
{ "name": "worker-1", "capacity": 1, "metadata": { "pid": 123 } }
→ 201 Worker
→ 400 { "error": "name (string) is required" }
```

**Heartbeat** (also extends leases for held tasks; fenced per lease)

```
POST /api/workers/:id/heartbeat
{ "leases": [{ "taskId": "<uuid>", "leaseToken": "<token>" }] }
→ 200 {
    "worker": Worker,
    "paused": false,        // true when the worker's network is cut (demo mode)
    "revoked": ["<taskId>"] // leases the server refused to extend
  }
→ 409 { "error": "unknown worker - re-register required" }
```

**Graceful shutdown** (releases running tasks immediately)

```
POST /api/workers/:id/shutdown
→ 200 { "ok": true, "released": true }
→ 404 { "error": "worker not found" }
```

**List workers**

```
GET /api/workers
→ 200 Worker[]
```

**Get worker + its running tasks**

```
GET /api/workers/:id
→ 200 { "worker": Worker, "running": Task[], "retrying": Task[] }
→ 404 { "error": "worker not found" }
```

### System

```
GET /api/queue    → 200 QueueSnapshot
GET /api/metrics  → 200 MetricsSnapshot
```

---

## Demo / control-plane API

Enabled by default; disabled with `CHAOS_ENABLED=false` (then all of these return `403`).

**Add a worker** (spawns a real OS process; name auto-assigned `worker-N`)

```
POST /api/admin/chaos/spawn-worker
→ 201 { "name": "worker-3", "pid": 23456 }
```

**Terminate a worker** (SIGKILL the process; its leases expire and are recovered)

```
POST /api/admin/chaos/kill-worker/:name
→ 200 { "ok": true, "name": "worker-3" }
→ 404 { "error": "no such managed worker" }
```

**Simulate natural failure** — cut the worker's heartbeats. The process keeps
running but the server times it out and marks it offline, exactly like a real
network failure. Tasks are recovered on lease expiry.

```
POST /api/admin/chaos/pause-heartbeats/:name
→ 200 { "ok": true, "name": "worker-3", "paused": true }
POST /api/admin/chaos/resume-heartbeats/:name
→ 200 { "ok": true, "name": "worker-3", "paused": false }
```

**Move a running task from worker A to worker B** (manual reassignment)

```
POST /api/admin/chaos/tasks/:id/reassign
{ "fromWorkerId": "<uuid>", "toWorkerId": "<uuid>" }
→ 200 Task                       // attempt +1, fresh lease for B
→ 400 { "error": "fromWorkerId and toWorkerId required" }
→ 409 { "error": "task not running on fromWorkerId (already moved, completed, or finished)" }
```

**Seed a deterministic task mix**

```
POST /api/admin/chaos/seed-tasks
{ "count": 24, "seed": 42, "crashCount": 1 }   // all optional
→ 200 { "scheduled": 24, "mix": { "demo.sleep": 10, "demo.crash": 1, ... } }
```

**Wipe everything** (kills managed workers, truncates tasks/workers/events)

```
POST /api/admin/chaos/reset
→ 200 { "ok": true }
```

**List managed workers**

```
GET /api/admin/chaos/workers
→ 200 { "managed": ["worker-3", "worker-4"], "paused": [] }
```

---

## WebSocket

Connect to:

```
ws://localhost:8080/ws
```

The first message is a full snapshot; afterwards only deltas are pushed.
If the socket drops, fall back to polling `GET /api/tasks?limit=200` and
`GET /api/metrics` every ~3s.

### Server → client messages

**1. Full snapshot (on connect)**

```json
{ "type": "snapshot", "payload": {
    "tasks": Task[],        // newest first
    "workers": Worker[],
    "queue": QueueSnapshot,
    "metrics": MetricsSnapshot,
    "events": TaskEvent[]   // recent, oldest → newest
} }
```

**2. Task updated (a task changed or was created)**

```json
{ "type": "task.updated", "payload": { "type": "LEASED", "task": Task, "at": "ISO" } }
```

**3. Event appended (append to your event feed)**

```json
{ "type": "task.event", "payload": { "type": "COMPLETED", "event": TaskEvent, "at": "ISO" } }
```

**4. Worker updated (registered / heartbeat / status change)**

```json
{ "type": "worker.updated", "payload": { "type": "WORKER_REGISTERED", "worker": Worker, "at": "ISO" } }
```

**5. Metrics tick (pushed periodically)**

```json
{ "type": "metrics", "payload": { "type": "metrics", "metrics": MetricsSnapshot, "at": "ISO" } }
```

### Recommended client handling

- `task.updated`: upsert by `task.id` (replace if present, prepend if new).
- `task.event`: append to an event ring buffer for the activity feed.
- `worker.updated`: upsert by `worker.id`.
- `metrics`: replace the metrics object.
- Reconnect with exponential backoff (1s → 10s max).

---

## Demo walkthrough (the failover story)

1. `POST /api/admin/chaos/spawn-worker` ×2 → healthy fleet.
2. `POST /api/tasks` `{ "type": "demo.sleep", "payload": { "workMs": 60000 } }` → task created.
3. Watch `task.updated` until `status === 'running'`; `assignedWorkerId` = holder (worker A).
4. **Failure**: `POST /api/admin/chaos/pause-heartbeats/:nameA` (natural) or
   `POST /api/admin/chaos/kill-worker/:nameA` (crash).
5. Watch the chain: `WORKER_TIMEOUT` → `RECOVERED` → `LEASED` (attempt 2) → `COMPLETED`.
6. Alternative to 4–5: `POST /api/admin/chaos/tasks/:id/reassign` to move the
   task from A to B directly.
7. Queued tasks with no free worker show `assignedWorkerId === null` and
   `status === 'pending'` — the "no worker available" state.
