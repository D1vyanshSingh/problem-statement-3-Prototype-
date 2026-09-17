import { useState } from 'react';
import { useSnapshot, useMode, useEventFeed, api } from '../store';
import { Card, ConnectionDot, StatusBadge } from '../components/ui';
import type { Task, Worker } from '../types';

/**
 * Failover tab — one simulation, one screen:
 * a worker is running a task, simulate it going offline naturally
 * (heartbeats stop, exactly like a real failure), and watch the system
 * detect it, recover the task, and reassign it to another worker.
 */

const CHAIN = [
  { type: 'WORKER_TIMEOUT', label: 'Failure detected (heartbeat timeout)' },
  { type: 'RECOVERED', label: 'Task recovered' },
  { type: 'LEASED', label: 'Task reassigned to a healthy worker' },
  { type: 'COMPLETED', label: 'Task completed' },
] as const;

export default function FailoverPage() {
  const s = useSnapshot();
  const mode = useMode();
  const feed = useEventFeed(300);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [victimId, setVictimId] = useState<string | null>(null);
  const [simTaskId, setSimTaskId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const workerName = (id: string | null | undefined): string =>
    (id && s.workers.find((w) => w.id === id)?.name) || '—';

  const runningTasks = s.tasks.filter((t) => t.status === 'running' && t.assignedWorkerId);
  const simTask = simTaskId ? s.tasks.find((t) => t.id === simTaskId) ?? null : null;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      // Make sure there is a spare healthy worker to receive the task.
      const healthy = s.workers.filter((w) => w.status === 'online');
      if (healthy.length < 2) {
        setNote('Adding a worker so there is somewhere to reassign the task…');
        await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
        await new Promise((r) => setTimeout(r, 2500));
      }
      // Launch a task, wait for a worker to pick it up, remember who.
      setNote('Launching a task…');
      const t = await api<Task>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ type: 'demo.sleep', payload: { workMs: 90000 }, maxAttempts: 3 }),
      });
      setSimTaskId(t.id);
      let holder: Worker | undefined;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const cur = (await api<Task[]>(`/api/tasks?limit=50`)).find((x) => x.id === t.id);
        if (cur?.status === 'running' && cur.assignedWorkerId) {
          holder = s.workers.find((w) => w.id === cur.assignedWorkerId);
          break;
        }
      }
      if (!holder) {
        setError('No worker picked up the task. Add a worker and try again.');
        setBusy(false);
        return;
      }
      setVictimId(holder.id);
      setNote(`${holder.name} picked up the task. Simulating failure…`);
      await api(`/api/admin/chaos/pause-heartbeats/${holder.name}`, { method: 'POST' });
      setNote(`${holder.name} stopped sending heartbeats — the system should detect and recover it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chainReached = (type: string): boolean => {
    if (type === 'COMPLETED') return simTask?.status === 'completed';
    return feed.some((e) => e.type === type && (!e.taskId || !simTask || e.taskId === simTask.id));
  };

  const reset = () => {
    setVictimId(null);
    setSimTaskId(null);
    setNote(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Failover simulation</h2>
          <p className="text-xs text-slate-500">
            A worker running a task goes offline. The system detects it and reassigns the task.
          </p>
        </div>
        <ConnectionDot mode={mode} />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-900 bg-rose-950/60 px-4 py-2 text-sm text-rose-200">{error}</div>
      )}
      {note && (
        <div className="rounded-lg border border-sky-800 bg-sky-950/60 px-4 py-2 text-sm text-sky-200">{note}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="The worker">
          {victimId ? (
            (() => {
              const w = s.workers.find((x) => x.id === victimId);
              const online = w?.status === 'online';
              return (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 font-semibold">
                      <span className={`h-3 w-3 rounded-full ${online ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                      {w?.name ?? workerName(victimId)}
                    </div>
                    <span className={`text-sm ${online ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {online ? 'online' : 'offline'}
                    </span>
                  </div>
                  {simTask && (
                    <div className="text-sm text-slate-400">
                      was running task <span className="font-mono text-slate-300">{simTask.id.slice(0, 8)}</span>{' '}
                      <StatusBadge status={simTask.status} />
                    </div>
                  )}
                  {simTask?.status === 'completed' && (
                    <button onClick={reset} className="mt-4 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs">
                      Reset simulation
                    </button>
                  )}
                </div>
              );
            })()
          ) : (
            <div>
              <p className="text-sm text-slate-400 mb-4">
                Start the simulation: a task is created, a worker picks it up, and that worker goes
                offline mid-task — heartbeats stop, just like a real failure. No crash is forced.
              </p>
              <button
                onClick={start}
                disabled={busy || runningTasks.length > 0}
                className="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-sm font-medium"
                title={runningTasks.length > 0 ? 'Wait for current running tasks to finish' : undefined}
              >
                {busy ? 'Setting up…' : 'Simulate worker failure'}
              </button>
              {runningTasks.length > 0 && (
                <p className="text-xs text-amber-400 mt-2">
                  A task is currently running — wait for it to complete first so the demo is clean.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="What the system does">
          <div className="space-y-2">
            {CHAIN.map((c) => {
              const done = chainReached(c.type);
              return (
                <div key={c.type} className="flex items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                  <span className={done ? 'text-slate-200' : 'text-slate-500'}>{c.label}</span>
                  {done && <span className="ml-auto text-emerald-400 text-xs">✓</span>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Event log">
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {feed.slice(-40).reverse().map((e) => (
            <div key={e.id} className="flex items-baseline gap-2 text-xs">
              <span className="text-slate-600 shrink-0 w-16">
                {new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span
                className={`font-medium shrink-0 ${
                  e.type === 'COMPLETED'
                    ? 'text-emerald-400'
                    : e.type === 'WORKER_TIMEOUT'
                      ? 'text-red-400'
                      : e.type === 'RECOVERED'
                        ? 'text-violet-400'
                        : 'text-slate-400'
                }`}
              >
                {e.type.toLowerCase().replace('_', ' ')}
              </span>
              {e.taskId && <span className="text-slate-500">{e.taskId.slice(0, 8)}</span>}
            </div>
          ))}
          {feed.length === 0 && <div className="text-xs text-slate-500">No events yet.</div>}
        </div>
      </Card>
    </div>
  );
}
