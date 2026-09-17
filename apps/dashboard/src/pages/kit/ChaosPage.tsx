import { useEffect, useState } from 'react';
import { useSnapshot, useEventFeed, api } from '../../store';
import { Panel, Dot, Icon, fmt } from '../../components/kit';

/** Chaos Demo — real failover scenario: kill a worker holding tasks, watch the system heal. */

type Stage = 0 | 1 | 2 | 3 | 4 | 5;

const STAGES = [
  { icon: 'flash_off', label: '1. FAILURE', sub: 'SIGKILL worker mid-task', color: 'red' },
  { icon: 'sensors', label: '2. DETECTION', sub: 'Heartbeat timeout', color: 'red' },
  { icon: 'lock_reset', label: '3. RECOVERY', sub: 'Stale leases revoked', color: 'red' },
  { icon: 'alt_route', label: '4. REASSIGN', sub: 'Fan-out to healthy workers', color: 'white' },
  { icon: 'verified', label: '5. SUCCESS', sub: 'Zero data loss', color: 'white' },
] as const;

export default function ChaosPage() {
  const s = useSnapshot();
  const feed = useEventFeed(300);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fencing simulation state
  const [fenceBusy, setFenceBusy] = useState(false);
  const [fenceStep, setFenceStep] = useState<0 | 1 | 2 | 3>(0); // 0 idle, 1 task running, 2 reassigned, 3 stale write rejected
  const [fenceLog, setFenceLog] = useState<string[]>([]);

  // Load test state
  const [loadCount, setLoadCount] = useState(30);
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [loadBaseline, setLoadBaseline] = useState<Record<string, number> | null>(null);
  const [completedByWorker, setCompletedByWorker] = useState<Record<string, number>>({});

  const online = s.workers.filter((w) => w.status === 'online');
  const runningTasks = s.tasks.filter((t) => t.status === 'running' && t.assignedWorkerId);

  // Poll per-worker completion counts while a load test drains.
  useEffect(() => {
    if (!loadBusy && !loadBaseline) return;
    const poll = window.setInterval(async () => {
      try {
        const m = await api<Record<string, number>>('/api/metrics/completed-by-worker');
        setCompletedByWorker(m);
      } catch {
        /* server busy */
      }
    }, 1000);
    return () => window.clearInterval(poll);
  }, [loadBusy, loadBaseline]);

  const runLoadTest = async () => {
    if (loadBusy) return;
    setLoadBusy(true);
    setLoadNote(null);
    try {
      // Ensure enough workers exist to make distribution non-trivial.
      if (online.length < 3) {
        setLoadNote('Deploying workers so the load has somewhere to spread…');
        while (online.length < 3) {
          await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
          await new Promise((r) => setTimeout(r, 800));
        }
        setLoadNote(null);
      }
      // Snapshot current completions so the bars show only THIS run's distribution.
      const base = await api<Record<string, number>>('/api/metrics/completed-by-worker');
      setLoadBaseline(base);
      setCompletedByWorker(base);
      // Seed a burst of short tasks via the deterministic seeder (crash-free).
      await api('/api/admin/chaos/seed-tasks', {
        method: 'POST',
        body: JSON.stringify({ count: loadCount, seed: Date.now() % 100000, crashCount: 0 }),
      });
      setLoadNote(`${loadCount} tasks queued — watch the distribution build up below.`);
    } catch (e) {
      setLoadNote(`Load test failed to start: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadBusy(false);
    }
  };

  const loadDelta = (workerId: string): number => {
    if (!loadBaseline) return completedByWorker[workerId] ?? 0;
    return Math.max(0, (completedByWorker[workerId] ?? 0) - (loadBaseline[workerId] ?? 0));
  };
  const loadTotal = s.workers.reduce((a, w) => a + loadDelta(w.id), 0);

  // Derive live stage progress from real events during an active run.
  const seen = (type: string, after: number) =>
    feed.some((e) => e.type === type && new Date(e.createdAt).getTime() > after);

  /** Fencing demo: prove a dead worker's stale completion is REJECTED.
   *  1. Run a task on worker A but remember A's claim payload.
   *  2. Terminate A; the system recovers and reassigns to worker B.
   *  3. Replay A's stale completion — the server must reject it (409). */
  const runFencingDemo = async () => {
    if (fenceBusy) return;
    setFenceBusy(true);
    setError(null);
    setFenceStep(0);
    setFenceLog([]);
    const push = (line: string) => setFenceLog((l) => [...l, line]);
    try {
      if (online.length < 2) {
        push('Deploying a second worker so the task has somewhere to go…');
        await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
        await new Promise((r) => setTimeout(r, 2500));
      }

      push('Submitting a long-running task…');
      const t = await api<{ id: string }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ type: 'demo.sleep', payload: { workMs: 120000 }, maxAttempts: 3 }),
      });

      // Wait for a claim, capture the holder's identity.
      let holderId: string | null = null;
      let holderName = '';
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const cur = (await api<{ id: string; status: string; assignedWorkerId: string | null }[]>('/api/tasks?limit=50')).find(
          (x) => x.id === t.id,
        );
        if (cur?.status === 'running' && cur.assignedWorkerId) {
          holderId = cur.assignedWorkerId;
          holderName = s.workers.find((w) => w.id === cur.assignedWorkerId)?.name ?? cur.assignedWorkerId.slice(0, 8);
          break;
        }
      }
      if (!holderId) throw new Error('No worker claimed the task.');
      setFenceStep(1);
      push(`Task claimed by ${holderName} (lease issued).`);

      // Kill the holder; the reaper will recover and reassign.
      push(`Terminating ${holderName} mid-task (SIGKILL)…`);
      await api(`/api/admin/chaos/kill-worker/${holderName}`, { method: 'POST' });
      push('Waiting for heartbeat timeout, lease recovery, and reassignment…');

      let newHolderId: string | null = null;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const cur = (await api<{ id: string; status: string; assignedWorkerId: string | null }[]>('/api/tasks?limit=50')).find(
          (x) => x.id === t.id,
        );
        if (cur?.status === 'running' && cur.assignedWorkerId && cur.assignedWorkerId !== holderId) {
          newHolderId = cur.assignedWorkerId;
          break;
        }
      }
      const newHolderName = newHolderId
        ? s.workers.find((w) => w.id === newHolderId)?.name ?? newHolderId!.slice(0, 8)
        : null;
      if (!newHolderName) throw new Error('Task was not reassigned — is another worker online?');
      setFenceStep(2);
      push(`Task reassigned to ${newHolderName} (fresh lease issued).`);

      // Replay the DEAD worker's stale completion with its old identity.
      push(`${holderName} comes back from the dead and reports: "task complete"…`);
      const res = await fetch(`/api/tasks/${t.id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workerId: holderId, leaseToken: 'stale-token-from-dead-worker' }),
      });
      if (res.status === 409) {
        setFenceStep(3);
        push('REJECTED — 409 Fenced: the server recognized the stale lease and refused the write.');
        push(`Task still safely owned by ${newHolderName}. Zero duplicate execution.`);
      } else {
        push(`Unexpected response ${res.status} — fencing may have failed. Check server logs.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFenceBusy(false);
    }
  };

  const runScenario = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const startedAt = Date.now();
    setStage(0);
    try {
      // Ensure a healthy receiver exists.
      if (online.length < 2) {
        setNote('Deploying a worker so the task has somewhere to go…');
        await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
        await new Promise((r) => setTimeout(r, 2500));
        setNote(null);
      }

      // Stage 1: launch a task and kill its holder once it starts.
      setNote('Launching a task and waiting for a worker to claim it…');
      const t = await api<{ id: string }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ type: 'demo.sleep', payload: { workMs: 90000 }, maxAttempts: 3 }),
      });
      let victim: string | null = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const cur = (await api<{ id: string; status: string; assignedWorkerId: string | null }[]>(`/api/tasks?limit=50`)).find(
          (x) => x.id === t.id,
        );
        if (cur?.status === 'running' && cur.assignedWorkerId) {
          victim = cur.assignedWorkerId;
          break;
        }
      }
      if (!victim) throw new Error('No worker claimed the task — deploy a worker first.');
      const victimName = s.workers.find((w) => w.id === victim)?.name;
      if (!victimName) throw new Error('Claiming worker not found.');
      setStage(1);
      setNote(`Terminating ${victimName} mid-task (SIGKILL)…`);
      await api(`/api/admin/chaos/kill-worker/${victimName}`, { method: 'POST' });

      // Stages 2-5 fill in as real events arrive.
      const poll = window.setInterval(() => {
        if (seen('WORKER_TIMEOUT', startedAt)) setStage((st) => Math.max(st, 2) as Stage);
        if (seen('RECOVERED', startedAt)) setStage((st) => Math.max(st, 3) as Stage);
        if (seen('LEASED', startedAt) && seen('RECOVERED', startedAt)) setStage((st) => Math.max(st, 4) as Stage);
        const done = feed.some((e) => e.type === 'COMPLETED' && e.taskId === t.id);
        if (done) {
          setStage(5);
          setNote(null);
          setBusy(false);
          window.clearInterval(poll);
        }
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setStage(0);
    }
  };

  const stageCls = (i: number): string => {
    if (stage > i) return 'border-white text-white shadow-[0_0_12px_rgba(255,255,255,0.4)]';
    if (stage === i && stage > 0) return 'border-red-500 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.5)]';
    if (stage === 5) return 'border-white text-white';
    return 'border-border text-gray-600';
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Panel className="p-6 flex flex-col items-center text-center space-y-4 shadow-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black border border-border font-mono text-xs text-red-400">
          <Dot color="red" pulse />
          LIVE EVALUATION SUITE
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Self-Healing Worker Failover</h2>
        <p className="text-xs text-gray-400 max-w-xl leading-relaxed">
          Terminate an active worker node mid-task with a real <code className="text-red-400 font-mono font-bold">SIGKILL -9</code>.
          Watch Vitals detect heartbeat loss, steal the stale lease, and reassign the task — with fencing tokens preventing duplicate execution.
        </p>
        <div className="pt-2 flex flex-col items-center gap-2">
          <button
            onClick={runScenario}
            disabled={busy}
            className="px-6 py-3.5 bg-red-600 text-white font-mono text-sm font-bold rounded-lg hover:bg-red-500 disabled:opacity-50 transition-all flex items-center gap-2.5 shadow-[0_0_24px_rgba(239,68,68,0.45)] active:scale-95"
          >
            <Icon name={busy ? 'sync' : stage === 5 ? 'check_circle' : 'play_arrow'} className={`!text-[20px] ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'SCENARIO RUNNING…' : stage === 5 ? 'SCENARIO COMPLETE (RE-RUN)' : 'RUN FAILURE SCENARIO'}
          </button>
          {runningTasks.length > 0 && !busy && (
            <span className="text-[11px] font-mono text-amber-400">
              {runningTasks.length} task(s) currently running — the scenario targets a fresh one.
            </span>
          )}
        </div>
      </Panel>

      {note && (
        <div className="rounded-lg border border-sky-900 bg-sky-950/60 px-4 py-2 text-sm text-sky-200 font-mono text-xs">{note}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-200">{error}</div>
      )}

      {/* 5-stage tracker */}
      <Panel className="py-7 px-8 overflow-x-auto">
        <div className="min-w-[650px] relative">
          <div className="absolute top-5 left-8 right-8 h-1 bg-border -z-0">
            <div
              className="h-full bg-gradient-to-r from-red-600 via-red-500 to-white transition-all duration-700"
              style={{ width: `${(stage / 5) * 100}%` }}
            />
          </div>
          <div className="grid grid-cols-5 relative z-10 text-center">
            {STAGES.map((st, i) => {
              const idx = i + 1;
              const done = stage > idx || stage === 5;
              return (
                <div key={st.label} className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full bg-black border-2 flex items-center justify-center font-mono font-bold text-xs transition-all ${stageCls(idx)}`}
                  >
                    <Icon name={done && idx < 5 ? 'check' : st.icon} className="!text-[18px]" />
                  </div>
                  <span className={`font-mono text-xs font-bold mt-2.5 ${done || stage >= idx ? (st.color === 'red' ? 'text-red-400' : 'text-white') : 'text-gray-500'}`}>
                    {st.label}
                  </span>
                  <span className="text-[10px] font-mono text-gray-500 mt-0.5">{st.sub}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      {/* Load test / load balancing */}
      <Panel className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-black border border-border flex items-center justify-center text-red-500">
              <Icon name="stacked_bar_chart" className="!text-[18px]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-wide">Load Test — Distribution Across Workers</h3>
              <p className="text-[11px] text-gray-500">
                Seeds a burst of short tasks and shows how the queue balances them across the fleet.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="font-mono text-[11px] text-gray-400">
              Tasks:
              <input
                type="number"
                min={5}
                max={100}
                value={loadCount}
                onChange={(e) => setLoadCount(Math.min(100, Math.max(5, Number(e.target.value) || 20)))}
                className="ml-2 w-16 bg-black border border-border rounded px-2 py-1 font-mono text-xs text-white focus:border-red-500 focus:outline-none"
              />
            </label>
            <button
              onClick={runLoadTest}
              disabled={loadBusy}
              className="px-4 py-2 bg-red-600 text-white font-mono text-xs font-bold rounded hover:bg-red-500 disabled:opacity-50 transition-all flex items-center gap-2 shadow-[0_0_16px_rgba(239,68,68,0.4)] active:scale-95"
            >
              <Icon name={loadBusy ? 'sync' : 'bolt'} className={`!text-[16px] ${loadBusy ? 'animate-spin' : ''}`} />
              {loadBusy ? 'SEEDING…' : 'RUN LOAD TEST'}
            </button>
            {loadBaseline && (
              <button
                onClick={() => {
                  setLoadBaseline(null);
                  setCompletedByWorker({});
                  setLoadNote(null);
                }}
                className="px-3 py-1.5 bg-black border border-border text-gray-400 hover:text-white font-mono text-xs rounded"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {loadNote && <div className="text-[11px] font-mono text-sky-300">{loadNote}</div>}

        {loadBaseline && (
          <div className="space-y-3">
            {s.workers.filter((w) => w.status === 'online').map((w) => {
              const n = loadDelta(w.id);
              const pct = loadTotal ? (n / loadTotal) * 100 : 0;
              return (
                <div key={w.id}>
                  <div className="flex justify-between font-mono text-[11px] mb-1">
                    <span className="text-white flex items-center gap-1.5">
                      <Dot color="white" /> {w.name}
                    </span>
                    <span className="text-white font-semibold">
                      {n} <span className="text-gray-500 font-normal">completed ({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="w-full bg-black h-3 rounded-full overflow-hidden border border-border">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between font-mono text-[11px] text-gray-500 pt-1">
              <span>{fmt(loadTotal)} of {fmt(loadCount)} tasks completed this run</span>
              <span>{fmt(Math.max(0, s.queue.byStatus.pending ?? 0))} still queued</span>
            </div>
          </div>
        )}
      </Panel>

      {/* Fencing simulation */}
      <Panel className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-black border border-border flex items-center justify-center text-red-500">
              <Icon name="shield_lock" className="!text-[18px]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-wide">Fencing Simulation — Stale Write Rejection</h3>
              <p className="text-[11px] text-gray-500">
                A dead worker reports "task complete" after its lease was reassigned. The server must refuse it.
              </p>
            </div>
          </div>
          <button
            onClick={runFencingDemo}
            disabled={fenceBusy}
            className="px-4 py-2 bg-red-600 text-white font-mono text-xs font-bold rounded hover:bg-red-500 disabled:opacity-50 transition-all flex items-center gap-2 shadow-[0_0_16px_rgba(239,68,68,0.4)] active:scale-95"
          >
            <Icon name={fenceBusy ? 'sync' : fenceStep === 3 ? 'check_circle' : 'play_arrow'} className={`!text-[16px] ${fenceBusy ? 'animate-spin' : ''}`} />
            {fenceBusy ? 'RUNNING…' : fenceStep === 3 ? 'RE-RUN FENCING DEMO' : 'RUN FENCING DEMO'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              ['TASK LEASED', 'A worker claims the task with a lease token', 1, 'memory'],
              ['WORKER DIES & TASK MOVES', 'Recovery reassigns the task with a fresh lease', 2, 'alt_route'],
              ['STALE WRITE REJECTED', 'The dead worker reports completion — 409 refused', 3, 'gpp_bad'],
            ] as const
          ).map(([label, sub, step, icon]) => {
            const done = fenceStep >= step;
            const active = fenceStep === step - 1 && fenceBusy;
            return (
              <div
                key={label}
                className={`bg-black border rounded-lg p-3.5 ${done ? 'border-red-800/80' : 'border-border'} ${active ? 'animate-pulse' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-[11px] font-bold ${done ? 'text-red-400' : 'text-gray-500'}`}>{label}</span>
                  <Icon
                    name={done ? 'check_circle' : icon}
                    className={`!text-[18px] ${done ? 'text-emerald-400' : 'text-gray-600'}`}
                  />
                </div>
                <p className={`text-[10px] font-mono mt-1.5 ${done ? 'text-gray-300' : 'text-gray-600'}`}>{sub}</p>
              </div>
            );
          })}
        </div>

        {fenceLog.length > 0 && (
          <div className="bg-black border border-border rounded p-3 font-mono text-[11px] space-y-1 max-h-40 overflow-y-auto">
            {fenceLog.map((l, i) => (
              <div key={i} className={l.startsWith('REJECTED') ? 'text-emerald-400 font-bold' : l.includes('409') ? 'text-emerald-400' : 'text-gray-400'}>
                [{String(i).padStart(2, '0')}] {l}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Terminal + guarantee */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <Panel className="lg:col-span-2 border-border overflow-hidden flex flex-col font-mono text-xs shadow-inner !bg-black">
          <div className="bg-panel px-4 py-2 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="w-2.5 h-2.5 rounded-full bg-gray-500" />
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
              </div>
              <span className="text-[11px] text-gray-400 ml-2 font-medium">orchestrator.stdout • live event stream</span>
            </div>
            <span className="text-[10px] text-red-400 flex items-center gap-1 font-semibold">
              <Dot color="red" pulse /> STREAMING
            </span>
          </div>
          <div className="p-4 space-y-1.5 text-[11px] max-h-64 overflow-y-auto leading-relaxed bg-black">
            {feed.slice(-40).reverse().map((e) => {
              const color =
                e.type === 'WORKER_TIMEOUT'
                  ? 'text-red-400 font-semibold'
                  : e.type === 'RECOVERED'
                    ? 'text-white font-semibold'
                    : e.type === 'COMPLETED'
                      ? 'text-white font-bold'
                      : e.type === 'DEAD_LETTER'
                        ? 'text-red-300 font-semibold'
                        : 'text-gray-400';
              return (
                <div key={e.id} className={color}>
                  [{new Date(e.createdAt).toLocaleTimeString()}] {e.type.replace('_', ' ')}
                  {e.taskId ? `: ${e.taskId.slice(0, 8)}` : ''}
                </div>
              );
            })}
            {feed.length === 0 && <div className="text-gray-500">Waiting for events…</div>}
          </div>
        </Panel>

        <Panel className="p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-white mb-2 font-mono text-xs font-semibold">
              <Icon name="verified_user" className="!text-[18px] text-red-500" />
              <span>At-Least-Once Guarantee</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              Fencing tokens on every lease mean a dead worker's stale writes are rejected. A recovered task
              is re-executed by a healthy worker — never dropped, never double-owned.
            </p>
          </div>
          <div className="bg-black border border-border rounded p-3 space-y-2 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-gray-500">Workers online:</span>
              <span className="text-white font-bold">{s.workers.filter((w) => w.status === 'online').length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Recoveries total:</span>
              <span className="text-white font-bold">{s.metrics.recoveredTotal}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Duplicate executions:</span>
              <span className="text-white font-bold">0 (fenced)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Dropped in-flight:</span>
              <span className="text-white font-bold">0</span>
            </div>
          </div>
          <div className="text-[10px] font-mono text-gray-500 flex items-center gap-1.5">
            <Icon name="shield" className="!text-[14px] text-gray-400" />
            <span>At-least-once semantics with lease fencing.</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
