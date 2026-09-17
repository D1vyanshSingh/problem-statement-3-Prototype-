import { useState } from 'react';
import { useSnapshot, useMode, useEventFeed, api } from '../store';
import { Card, ConnectionDot, StatusBadge } from '../components/ui';
import type { Task, Worker } from '../types';

function shortId(id: string): string {
  return id.slice(0, 8);
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function OperationsPage() {
  const s = useSnapshot();
  const mode = useMode();
  const feed = useEventFeed(300);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null); // task id being moved
  const [moveTarget, setMoveTarget] = useState<string>('');

  const workerName = (id: string | null | undefined): string =>
    (id && s.workers.find((w) => w.id === id)?.name) || '—';

  const heldTasks = (w: Worker): Task[] =>
    s.tasks.filter((t) => t.assignedWorkerId === w.id && t.status === 'running');

  const onlineWorkers = s.workers.filter((w) => w.status === 'online');
  const runningTasks = s.tasks.filter((t) => t.status === 'running');
  const pendingCount =
    (s.queue.byStatus.pending ?? 0) + (s.queue.byStatus.retrying ?? 0) + (s.queue.byStatus.scheduled ?? 0);
  const recentTasks = s.tasks.slice(0, 12);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addWorker = () =>
    run(async () => {
      await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
    });

  const terminate = (w: Worker) =>
    run(async () => {
      await api(`/api/admin/chaos/kill-worker/${w.name}`, { method: 'POST' });
    });

  const newTask = () =>
    run(async () => {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ type: 'demo.sleep', payload: { workMs: 60000 }, maxAttempts: 3 }),
      });
    });

  const move = (t: Task, toWorkerId: string) =>
    run(async () => {
      if (!t.assignedWorkerId) return;
      await api(`/api/admin/chaos/tasks/${t.id}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ fromWorkerId: t.assignedWorkerId, toWorkerId }),
      });
      setMoveFor(null);
      setMoveTarget('');
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Operations</h2>
          <p className="text-xs text-slate-500">Fleet, task queue, and recovery activity in real time.</p>
        </div>
        <ConnectionDot mode={mode} />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-900 bg-rose-950/60 px-4 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Workers online', value: onlineWorkers.length },
          { label: 'Running', value: runningTasks.length },
          { label: 'Queued', value: pendingCount },
          { label: 'Completed', value: s.metrics.completedTotal },
          { label: 'Failed', value: s.metrics.failedTotal },
        ].map((st) => (
          <div key={st.label} className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{st.label}</div>
            <div className="text-xl font-semibold mt-0.5">{st.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Workers */}
        <div className="lg:col-span-2">
          <Card
            title="Workers"
            className="h-full"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500">
                {onlineWorkers.length} online · {s.workers.length - onlineWorkers.length} offline
              </span>
              <button
                onClick={addWorker}
                disabled={busy}
                className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-sm font-medium"
              >
                Add worker
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                  <th className="py-2 font-medium">Worker</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Running</th>
                  <th className="py-2 font-medium">Last heartbeat</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {s.workers.map((w) => {
                  const held = heldTasks(w);
                  const online = w.status === 'online';
                  return (
                    <tr key={w.id} className="border-b border-slate-800/60">
                      <td className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                          {w.name}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span className={online ? 'text-emerald-400' : 'text-rose-400'}>
                          {online ? 'online' : 'offline'}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-300">
                        {held.length === 0 ? (
                          <span className="text-slate-600">idle</span>
                        ) : (
                          held.map((t) => shortId(t.id)).join(', ')
                        )}
                      </td>
                      <td className="py-2.5 text-slate-500">{timeAgo(w.lastHeartbeatAt)}</td>
                      <td className="py-2.5 text-right">
                        {online && (
                          <button
                            onClick={() => terminate(w)}
                            disabled={busy}
                            className="px-2.5 py-1 rounded bg-rose-900/70 hover:bg-rose-800 disabled:opacity-40 text-xs font-medium text-rose-100"
                            title={`Terminate ${w.name} immediately (SIGKILL)`}
                          >
                            Terminate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {s.workers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-slate-500 text-sm">
                      No workers registered. Add one to start processing tasks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Activity */}
        <Card title="Activity" className="h-full">
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {feed.slice(-40).reverse().map((e) => (
              <div key={e.id} className="flex items-baseline gap-2 text-xs">
                <span className="text-slate-600 shrink-0 w-14">
                  {new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span
                  className={`font-medium shrink-0 ${
                    e.type === 'COMPLETED'
                      ? 'text-emerald-400'
                      : e.type === 'DEAD_LETTER'
                        ? 'text-rose-400'
                        : e.type === 'WORKER_TIMEOUT'
                          ? 'text-red-400'
                          : e.type === 'RECOVERED'
                            ? 'text-violet-400'
                            : e.type.startsWith('RETRY')
                              ? 'text-orange-400'
                              : 'text-slate-400'
                  }`}
                >
                  {e.type.toLowerCase().replace('_', ' ')}
                </span>
                {e.taskId && <span className="text-slate-500">{shortId(e.taskId)}</span>}
              </div>
            ))}
            {feed.length === 0 && <div className="text-xs text-slate-500">No activity yet.</div>}
          </div>
        </Card>
      </div>

      {/* Tasks */}
      <Card
        title="Tasks"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-500">Most recent tasks across the cluster</span>
          <button
            onClick={newTask}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-medium"
            title="Submit a task that runs for 60 seconds — enough time to move or recover it"
          >
            New task
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
              <th className="py-2 font-medium">Task</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Worker</th>
              <th className="py-2 font-medium">Attempt</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {recentTasks.map((t) => {
              const movable = t.status === 'running' && t.assignedWorkerId;
              const candidates = onlineWorkers.filter((w) => w.id !== t.assignedWorkerId);
              return (
                <tr key={t.id} className="border-b border-slate-800/60">
                  <td className="py-2.5 font-mono text-xs text-slate-400">{shortId(t.id)}</td>
                  <td className="py-2.5">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="py-2.5 text-slate-300">
                    {t.assignedWorkerId ? (
                      workerName(t.assignedWorkerId)
                    ) : t.status === 'pending' || t.status === 'retrying' || t.status === 'scheduled' ? (
                      <span className="text-amber-400">no worker available</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5 text-slate-500">
                    {t.attempt}/{t.maxAttempts}
                  </td>
                  <td className="py-2.5 text-slate-500">{timeAgo(t.createdAt)}</td>
                  <td className="py-2.5 text-right">
                    {movable && candidates.length > 0 && moveFor !== t.id && (
                      <button
                        onClick={() => {
                          setMoveFor(t.id);
                          setMoveTarget('');
                        }}
                        disabled={busy}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs"
                      >
                        Move
                      </button>
                    )}
                    {movable && moveFor === t.id && (
                      <span className="inline-flex items-center gap-2">
                        <select
                          value={moveTarget}
                          onChange={(e) => setMoveTarget(e.target.value)}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs"
                          autoFocus
                        >
                          <option value="">Select worker</option>
                          {candidates.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => moveTarget && move(t, moveTarget)}
                          disabled={!moveTarget || busy}
                          className="px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-xs font-medium"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setMoveFor(null)}
                          className="text-slate-500 hover:text-slate-300 text-xs"
                        >
                          Cancel
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {recentTasks.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-slate-500 text-sm">
                  No tasks yet. Create one to see it assigned to a worker.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-600">
          Moving a running task reassigns it immediately; the previous worker's lease is revoked and its
          result is rejected if it reports one. Terminating a worker leaves its tasks to be recovered
          automatically when the heartbeat times out.
        </p>
      </Card>
    </div>
  );
}
