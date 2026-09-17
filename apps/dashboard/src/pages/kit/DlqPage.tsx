import { useMemo, useState } from 'react';
import { useSnapshot, api } from '../../store';
import { Panel, Icon, shortId, timeAgo } from '../../components/kit';
import type { Task } from '../../types';

/** DLQ — dead-letter queue with bulk reprocess. */

export default function DlqPage() {
  const s = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const dlqTasks = useMemo(() => s.tasks.filter((t) => t.status === 'dead_letter'), [s.tasks]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    setSelected(selected.size === dlqTasks.length ? new Set() : new Set(dlqTasks.map((t) => t.id)));
  };

  const reprocess = async (ids: string[]) => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const id of ids) {
        await api(`/api/tasks/${id}/retry`, { method: 'POST' });
      }
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-200">{error}</div>
      )}

      {/* Alert banner + bulk actions */}
      <Panel className="border-red-900/70 p-3 sm:p-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-950/80 border border-red-800 flex items-center justify-center text-red-400 shadow-[0_0_14px_rgba(239,68,68,0.3)]">
            <Icon name="warning" className="!text-[22px]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white tracking-wide">Dead-Letter Queue (Poison Pill Isolation)</h2>
              <span className="font-mono text-xs bg-red-950 text-red-300 px-2 py-0.5 rounded border border-red-800 font-bold">
                {dlqTasks.length} Failed Tasks
              </span>
            </div>
            <p className="text-[11px] font-mono text-gray-400">
              Exceeded maximum retry threshold. Execution paused to prevent cascade thrash.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <label className="flex items-center gap-2 text-gray-400 bg-black border border-border px-3 py-2 sm:py-1.5 rounded cursor-pointer hover:border-gray-500 active:bg-panel-hover">
            <input
              type="checkbox"
              className="accent-red-500 rounded"
              checked={dlqTasks.length > 0 && selected.size === dlqTasks.length}
              onChange={selectAll}
            />
            <span>Select All ({dlqTasks.length})</span>
          </label>
          <button
            onClick={() => reprocess([...selected])}
            disabled={busy || selected.size === 0}
            className="px-4 py-2 sm:px-3 sm:py-1.5 bg-red-600 text-white font-semibold rounded hover:bg-red-500 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-colors shadow-[0_0_12px_rgba(239,68,68,0.35)] active:bg-red-700"
          >
            <Icon name="refresh" className="!text-[16px]" />
            Reprocess Selected ({selected.size})
          </button>
          <a
            href="/api/reports/dlq"
            className="px-3 py-1.5 bg-black hover:bg-panel-hover border border-border hover:border-red-500 rounded text-gray-300 hover:text-red-300 flex items-center gap-1.5 transition-colors font-mono text-xs"
          >
            <Icon name="download" className="!text-[16px] text-red-500" />
            Download report
          </a>
        </div>
      </Panel>

      {/* DLQ cards */}
      <div className="space-y-3">
        {dlqTasks.map((t: Task) => (
          <Panel key={t.id} className="hover:border-red-800/80 p-3 sm:p-4 transition-all">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="accent-red-500 rounded"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span className="font-mono font-bold text-white text-sm">{shortId(t.id)}</span>
                <span className="text-xs font-mono text-gray-400">
                  • queue: <span className="text-gray-200">{t.type}</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950 border border-red-800 text-red-300 font-semibold">
                  ATTEMPTS: {t.attempt}/{t.maxAttempts}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-gray-500">Failed: {t.finishedAt ? timeAgo(t.finishedAt) : '—'}</span>
                <button
                  onClick={() => reprocess([t.id])}
                  disabled={busy}
                  className="px-2.5 py-1 bg-black hover:bg-panel-hover border border-border hover:border-red-500 text-white hover:text-red-400 font-mono text-xs rounded flex items-center gap-1 transition-colors disabled:opacity-40"
                >
                  <Icon name="refresh" className="!text-[14px] text-red-500" /> Reprocess
                </button>
              </div>
            </div>
            {/* Error block */}
            <div className="mt-3 bg-red-950/20 border border-red-900/60 rounded p-3 font-mono text-xs">
              <div className="text-red-400 font-semibold flex items-center gap-1.5 mb-1">
                <Icon name="error" className="!text-[14px]" />
                {t.lastError ?? 'Unknown error'}
              </div>
              <div className="text-gray-400 text-[11px] overflow-x-auto">
                Exhausted {t.maxAttempts} attempts with exponential backoff — isolated for manual reprocess.
              </div>
            </div>
          </Panel>
        ))}
        {dlqTasks.length === 0 && (
          <Panel className="p-10 flex flex-col items-center text-center">
            <Icon name="verified_user" className="!text-[32px] text-gray-600" />
            <p className="text-sm text-gray-300 mt-3 font-medium">Dead-letter queue is empty</p>
            <p className="text-[11px] font-mono text-gray-500 mt-1 max-w-sm">
              Tasks land here after exhausting every retry attempt. Reprocess them to reset the attempt counter.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
