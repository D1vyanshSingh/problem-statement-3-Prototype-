import { useMemo, useState } from 'react';
import { useSnapshot, useEventFeed, api } from '../../store';
import { Panel, Dot, Icon, shortId, timeAgo } from '../../components/kit';
import type { Task, TaskStatus } from '../../types';

/** Tasks — dense execution queue table + live lifecycle timeline drawer. */

const STATUS_STYLES: Record<TaskStatus, { cls: string; dot: 'red' | 'white' | 'gray'; pulse: boolean }> = {
  running: { cls: 'bg-red-950/80 border border-red-800 text-red-400', dot: 'red', pulse: true },
  completed: { cls: 'bg-panel-hover border border-gray-600 text-white', dot: 'white', pulse: false },
  retrying: { cls: 'bg-red-950/50 border border-red-800/80 text-red-300', dot: 'red', pulse: true },
  dead_letter: { cls: 'bg-red-950/80 border border-red-800 text-red-400', dot: 'red', pulse: false },
  pending: { cls: 'bg-panel border border-border-light text-gray-300', dot: 'gray', pulse: false },
  scheduled: { cls: 'bg-panel border border-border-light text-gray-300', dot: 'gray', pulse: false },
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const st = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 w-fit uppercase ${st.cls}`}>
      <Dot color={st.dot} pulse={st.pulse} />
      {status.replace('_', ' ')}
    </span>
  );
}

/** Vertical lifecycle timeline for the selected task, built from its event stream. */
function Timeline({ task, events }: { task: Task; events: { type: string; createdAt: string; detail?: Record<string, unknown> }[] }) {
  const mine = events.filter((e) => !e.type || true);
  const FLOW = ['CREATED', 'LEASED', 'RETRY_QUEUED', 'RECOVERED', 'COMPLETED', 'DEAD_LETTER'];
  const reached = FLOW.filter((f) => mine.some((e) => e.type === f));
  const isTerminal = task.status === 'completed' || task.status === 'dead_letter';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-white tracking-wide flex items-center gap-1.5">
          <Icon name="linear_scale" className="!text-[16px] text-red-500" />
          LIFECYCLE EVENT TIMELINE
        </span>
        <span className="text-[10px] font-mono text-red-400 bg-red-950/80 border border-red-800 px-2 py-0.5 rounded uppercase">
          STATE: {task.status.replace('_', ' ')}{isTerminal ? '' : ' (ACTIVE)'}
        </span>
      </div>
      <div className="relative pl-6 space-y-5 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-3 before:w-[2px] before:bg-gradient-to-b before:from-white before:via-red-500 before:to-border">
        {reached.map((type, i) => {
          const evts = mine.filter((e) => e.type === type);
          const last = evts[evts.length - 1];
          const isCurrent = !isTerminal && i === reached.length - 1;
          const color = type === 'CREATED' ? 'white' : isCurrent ? 'red' : 'gray';
          return (
            <div key={`${type}-${i}`} className="relative flex items-start gap-3">
              <span
                className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-panel border-2 flex items-center justify-center ${
                  color === 'red' ? 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)] pulse-live' : color === 'white' ? 'border-white' : 'border-border-light'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${color === 'red' ? 'bg-red-500' : color === 'white' ? 'bg-white' : 'bg-gray-600'}`} />
              </span>
              <div>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className={`font-bold ${isCurrent ? 'text-red-400' : 'text-white'}`}>
                    {type.replace('_', ' ')}{isCurrent ? ' (IN-PROGRESS)' : ''}
                  </span>
                  <span className="text-gray-500 text-[10px]">
                    {last ? new Date(last.createdAt).toLocaleTimeString() : ''}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {type === 'CREATED' && 'Task submitted via API'}
                  {type === 'LEASED' && `Acquired by worker ${String(last?.detail?.workerId ?? '').slice(0, 8) || '—'}`}
                  {type === 'RETRY_QUEUED' && `Attempt failed — backoff re-queue (${String(last?.detail?.error ?? '').slice(0, 60)})`}
                  {type === 'RECOVERED' && `Lease recovered from failed worker (${String(last?.detail?.reason ?? 'lease_expired')})`}
                  {type === 'COMPLETED' && 'Execution finished successfully'}
                  {type === 'DEAD_LETTER' && 'Exhausted all attempts — isolated in DLQ'}
                </p>
              </div>
            </div>
          );
        })}
        {/* Pending future stages */}
        {FLOW.filter((f) => !reached.includes(f) && (task.status !== 'completed' || f === 'COMPLETED')).slice(0, 2).map((f) => (
          <div key={f} className="relative flex items-start gap-3 opacity-40">
            <span className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-panel border-2 border-border flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />
            </span>
            <div>
              <div className="font-mono text-xs font-medium text-gray-500">{f.replace('_', ' ')}</div>
              <p className="text-[11px] text-gray-600 mt-0.5">Pending</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const s = useSnapshot();
  const feed = useEventFeed(300);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskKind, setTaskKind] = useState<'sleep' | 'flaky' | 'always_fail'>('sleep');

  const filtered = useMemo(
    () => (statusFilter === 'all' ? s.tasks : s.tasks.filter((t) => t.status === statusFilter)),
    [s.tasks, statusFilter],
  );
  const selected: Task | null = selectedId ? s.tasks.find((t) => t.id === selectedId) ?? null : null;
  const selectedEvents = selectedId ? feed.filter((e) => e.taskId === selectedId) : [];

  const counts = s.tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  const newTask = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (taskKind === 'sleep') {
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ type: 'demo.sleep', payload: { workMs: 60000 }, maxAttempts: 3 }),
        });
      } else if (taskKind === 'flaky') {
        // Fails twice, then succeeds: shows RETRYING -> RUNNING -> COMPLETED live.
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ type: 'demo.fail_until_attempt', payload: { failUntilAttempt: 2 }, maxAttempts: 5 }),
        });
      } else {
        // Always fails: exhausts retries and lands in the DLQ.
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ type: 'demo.always_fail', payload: { reason: 'judge-requested failure' }, maxAttempts: 3 }),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const retry = async (t: Task) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/tasks/${t.id}/retry`, { method: 'POST' });
    } catch {
      /* not in DLQ */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Panel className="p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-gray-400">Filters:</span>
          <div className="flex items-center gap-1 bg-black border border-border rounded p-1 text-xs font-mono">
            {(['all', 'running', 'pending', 'retrying', 'completed', 'dead_letter'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-0.5 rounded uppercase ${
                  statusFilter === st ? 'bg-panel-hover text-white border border-border' : 'text-gray-400 hover:text-white'
                }`}
              >
                {st === 'all' ? `All (${s.tasks.length})` : `${st.replace('_', ' ')} (${counts[st] ?? 0})`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-black border border-border rounded p-1 text-xs font-mono">
            {(
              [
                ['sleep', 'Normal (60s)'],
                ['flaky', 'Fails 2x then succeeds'],
                ['always_fail', 'Always fails (→ DLQ)'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTaskKind(k)}
                className={`px-2 py-0.5 rounded ${
                  taskKind === k
                    ? k === 'sleep'
                      ? 'bg-panel-hover text-white border border-border'
                      : 'bg-red-950/80 text-red-300 border border-red-800'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={newTask}
            disabled={busy}
            className="px-3 py-1.5 bg-red-600 text-white font-mono text-xs font-semibold rounded hover:bg-red-500 disabled:opacity-40 flex items-center gap-1"
          >
            <Icon name="add" className="!text-[16px]" /> New task
          </button>
        </div>
        <span className="font-mono text-xs text-gray-500">Live via WebSocket</span>
      </Panel>

      {/* Table + drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 bg-panel border border-border rounded-lg overflow-hidden shadow-lg">
          <div className="p-3 border-b border-border flex items-center justify-between bg-black">
            <div className="flex items-center gap-2">
              <Icon name="dns" className="!text-[16px] text-red-500" />
              <span className="font-mono text-xs font-semibold text-white">Active Execution Queue</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">Showing {Math.min(filtered.length, 20)} of {filtered.length} tasks</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="text-[11px] text-gray-400 border-b border-border bg-panel">
                  <th className="py-2.5 px-3">TASK ID</th>
                  <th className="py-2.5 px-3">STATUS</th>
                  <th className="py-2.5 px-3">TYPE</th>
                  <th className="py-2.5 px-3">WORKER</th>
                  <th className="py-2.5 px-3">ATTEMPTS</th>
                  <th className="py-2.5 px-3 text-right">AGE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-[11px]">
                {filtered.slice(0, 20).map((t) => {
                  const isSel = t.id === selectedId;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={`cursor-pointer transition-colors ${isSel ? 'bg-[#181A20] border-l-2 border-red-500' : 'hover:bg-panel-hover'}`}
                    >
                      <td className={`py-2.5 px-3 font-semibold flex items-center gap-1.5 ${isSel ? 'text-red-400' : 'text-gray-300'}`}>
                        {isSel && <Icon name="chevron_right" className="!text-[14px]" />}
                        {shortId(t.id)}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="py-2.5 px-3 text-gray-200">{t.type}</td>
                      <td className="py-2.5 px-3 text-gray-400">
                        {t.assignedWorkerId
                          ? s.workers.find((w) => w.id === t.assignedWorkerId)?.name ?? shortId(t.assignedWorkerId)
                          : t.status === 'pending' || t.status === 'retrying'
                            ? <span className="text-red-400">no worker available</span>
                            : '—'}
                      </td>
                      <td className={`py-2.5 px-3 ${t.attempt > 1 ? 'text-red-300 font-bold' : 'text-gray-400'}`}>
                        {t.attempt}/{t.maxAttempts}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-400">{timeAgo(t.createdAt)}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-gray-500">
                      No tasks match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail drawer */}
        <div className="lg:col-span-5 bg-panel border border-border rounded-lg p-5 space-y-5 shadow-2xl">
          {!selected ? (
            <div className="flex flex-col items-center justify-center text-center py-16 text-gray-500">
              <Icon name="touch_app" className="!text-[32px] text-border-light" />
              <p className="text-xs font-mono mt-3">Select a task to inspect its lifecycle</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between border-b border-border pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white">{shortId(selected.id)}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-950 border border-red-800 text-red-400 font-semibold uppercase">
                      {selected.status === 'running' ? 'LEASED' : selected.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-gray-400 mt-1">
                    Type: <span className="text-white font-medium">{selected.type}</span> • Priority: {selected.priority}
                  </div>
                </div>
                {selected.status === 'dead_letter' && (
                  <button
                    onClick={() => retry(selected)}
                    disabled={busy}
                    className="px-2.5 py-1 bg-red-600 text-white font-mono text-xs rounded hover:bg-red-500 disabled:opacity-40"
                  >
                    Reprocess
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] bg-black p-3 rounded border border-border">
                <div>
                  <span className="text-gray-500">Worker Node:</span>{' '}
                  <span className="text-white font-medium">
                    {selected.assignedWorkerId
                      ? s.workers.find((w) => w.id === selected.assignedWorkerId)?.name ?? shortId(selected.assignedWorkerId)
                      : 'unassigned'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Lease:</span>{' '}
                  <span className="text-white">{selected.leaseExpiresAt ? 'active' : 'none'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Attempt:</span>{' '}
                  <span className={selected.attempt > 1 ? 'text-red-400' : 'text-white'}>
                    {selected.attempt} of {selected.maxAttempts}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Created:</span> <span className="text-gray-300">{timeAgo(selected.createdAt)}</span>
                </div>
              </div>

              {/* Payload */}
              <div className="border border-border rounded bg-black overflow-hidden text-xs">
                <div className="px-3 py-1.5 bg-panel-hover border-b border-border flex items-center justify-between font-mono text-[11px] text-gray-300">
                  <span className="flex items-center gap-1.5 text-gray-200">
                    <Icon name="code" className="!text-[14px] text-red-500" /> Payload
                  </span>
                  <span className="text-gray-500 text-[10px]">JSON</span>
                </div>
                <pre className="p-3 font-mono text-[11px] text-gray-300 overflow-x-auto max-h-32">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </div>

              {selected.lastError && (
                <div className="bg-red-950/20 border border-red-900/60 rounded p-3 font-mono text-xs">
                  <div className="text-red-400 font-semibold flex items-center gap-1.5">
                    <Icon name="error" className="!text-[14px]" /> Last error
                  </div>
                  <div className="text-gray-400 text-[11px] mt-1">{selected.lastError}</div>
                </div>
              )}

              <Timeline task={selected} events={selectedEvents} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
