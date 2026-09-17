import { useMemo, useState } from 'react';
import { useSnapshot, useMode, api } from '../store';
import { Card, StatusBadge, ConnectionDot, ShortId } from '../components/ui';
import type { Task, TaskStatus } from '../types';

const FILTERS: Array<TaskStatus | 'all'> = [
  'all',
  'pending',
  'running',
  'retrying',
  'completed',
  'dead_letter',
  'scheduled',
];

export default function TasksPage() {
  const s = useSnapshot();
  const mode = useMode();
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);

  const tasks = useMemo(() => {
    let list = s.tasks;
    if (filter !== 'all') list = list.filter((t) => t.status === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.type.toLowerCase().includes(q) ||
          (t.lastError ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [s.tasks, filter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <ConnectionDot mode={mode} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
              filter === f ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {f}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search id / type / error"
          className="ml-auto bg-slate-900 border border-slate-800 rounded-md px-3 py-1.5 text-sm w-72 outline-none focus:border-sky-600"
        />
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-800">
              <th className="py-2 pr-3">ID</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Attempt</th>
              <th className="py-2 pr-3">Worker</th>
              <th className="py-2 pr-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {tasks.slice(0, 150).map((t) => (
              <tr
                key={t.id}
                className="border-b border-slate-800/60 hover:bg-slate-800/40 cursor-pointer"
                onClick={() => setSelected(t)}
              >
                <td className="py-1.5 pr-3"><ShortId id={t.id} /></td>
                <td className="py-1.5 pr-3">{t.type}</td>
                <td className="py-1.5 pr-3"><StatusBadge status={t.status} /></td>
                <td className="py-1.5 pr-3 text-slate-400">{t.attempt}/{t.maxAttempts}</td>
                <td className="py-1.5 pr-3 text-slate-500">{t.assignedWorkerId ? <ShortId id={t.assignedWorkerId} /> : '—'}</td>
                <td className="py-1.5 pr-3 text-slate-500 text-xs">{new Date(t.updatedAt).toLocaleTimeString()}</td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500 text-sm">
                  No tasks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {selected && (
        <div
          className="fixed inset-0 bg-black/60 flex justify-end z-20"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-lg bg-slate-900 border-l border-slate-800 h-full overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Task detail</h3>
              <button className="text-slate-500 hover:text-slate-300" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex gap-2"><span className="text-slate-500 w-24">ID</span><code className="text-xs">{selected.id}</code></div>
              <div className="flex gap-2"><span className="text-slate-500 w-24">Type</span>{selected.type}</div>
              <div className="flex gap-2"><span className="text-slate-500 w-24">Status</span><StatusBadge status={selected.status} /></div>
              <div className="flex gap-2"><span className="text-slate-500 w-24">Attempt</span>{selected.attempt} / {selected.maxAttempts}</div>
              <div className="flex gap-2"><span className="text-slate-500 w-24">Worker</span>{selected.assignedWorkerId ?? '—'}</div>
              <div className="flex gap-2"><span className="text-slate-500 w-24">Run at</span>{new Date(selected.runAt).toLocaleString()}</div>
              {selected.lastError && (
                <div className="flex gap-2"><span className="text-slate-500 w-24">Error</span>
                  <code className="text-xs text-rose-300">{selected.lastError}</code>
                </div>
              )}
              {selected.result && (
                <div className="flex gap-2"><span className="text-slate-500 w-24">Result</span>
                  <code className="text-xs text-emerald-300">{JSON.stringify(selected.result).slice(0, 300)}</code>
                </div>
              )}
              <div className="flex gap-2"><span className="text-slate-500 w-24">Payload</span>
                <code className="text-xs text-slate-300 break-all">{JSON.stringify(selected.payload).slice(0, 300)}</code>
              </div>
              {selected.status === 'dead_letter' && (
                <button
                  className="mt-3 px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-sm font-medium"
                  onClick={() =>
                    api(`/api/tasks/${selected.id}/retry`, { method: 'POST' })
                      .then(() => setSelected(null))
                      .catch((e) => alert(String(e)))
                  }
                >
                  Reprocess from DLQ
                </button>
              )}
              <div className="pt-3">
                <div className="text-xs uppercase text-slate-500 mb-2">Lifecycle timeline</div>
                <Timeline taskId={selected.id} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Timeline({ taskId }: { taskId: string }) {
  const events = useSnapshot().events.filter((e) => e.taskId === taskId);
  if (events.length === 0) return <div className="text-xs text-slate-500">No events captured in live feed.</div>;
  return (
    <div className="space-y-1">
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 w-16">{new Date(e.createdAt).toLocaleTimeString()}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{e.type}</span>
          <span className="text-slate-500">{JSON.stringify(e.detail).slice(0, 80)}</span>
        </div>
      ))}
    </div>
  );
}
