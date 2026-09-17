# TROUBLESHOOTING — one-line fixes

| Symptom | Fix |
|---|---|
| `embedded-postgres` binaries missing / pnpm blocked its build script | `pnpm approve-builds` (already pre-approved via `pnpm.onlyBuiltDependencies`; rerun `pnpm install` after) |
| Port 8080 already in use | `PORT=9090 pnpm dev` (find the squatter: `netstat -ano \| findstr :8080` → `taskkill /PID <pid> /F`) |
| Port 54329 already in use by something else | `EMBEDDED_PG_PORT=54330 pnpm dev` |
| Embedded pg fails to boot, suspect a stale `postmaster.pid` | `rm .data/pg/postmaster.pid` (safe: boot only does this after proving the port is dead) |
| Embedded pg refuses to start with "data directory already exists" | `rm -rf .data/pg` (fresh cluster; only loses local demo data) |
| Database deleted / `.data` wiped | Just run `pnpm dev` — it recreates and migrates automatically |
| Dashboard shows "polling fallback" instead of "live (ws)" | It self-heals (auto-reconnect + polling keeps data flowing); refresh the page if stuck >30s |
| Stale worker rows after a hard crash | Workers self-heal via 409 → re-register; or `POST /api/admin/chaos/reset` / `pnpm demo:reset` |
| Need a clean slate before presenting | `pnpm demo:reset` (wipes tasks/workers/events, respawns 2 workers) |
| Server was SIGKILLed — is my data gone? | No: rerun `pnpm dev`; it adopts the running Postgres and reaps expired leases on boot |
| Worker says "unknown worker - re-register required" | Normal after a reap: the worker re-registers automatically within one heartbeat cycle |
| Tasks stuck RUNNING forever | Only if the reaper is off (`REAPER_INTERVAL_MS` huge); restart `pnpm dev` — boot-time reaper pass recovers them |
| `pnpm test` hangs on Postgres boot | Another test/server instance holds the port; `taskkill` it or set `EMBEDDED_PG_PORT` + `PORT` for the test run |
| Vite dev server port 5173 busy | `pnpm --filter @vitals/dashboard dev -- --port 5174` |
| Windows: worker spawn fails with tsx resolution | `pnpm add -w tsx` then retry (chaos spawns run `--import tsx` from the repo root) |
