import { useState } from 'react';
import { useSnapshot, useMode, api } from '../store';
import { Card, ConnectionDot, ShortId } from '../components/ui';

export default function DlqPage() {
  const s = useSnapshot();
  const mode = useMode();
  const [busy, setBusy] = useState(false);
  const dead = s.tasks.filter((t) => t.status === 'dead_letter');

  const reprocess = async (id: string) => {
    setBusy(true);
    try {
      await api(`/api/tasks/${id}/retry`, { method: 'POST' });
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const reprocessAll = async () => {
    setBusy(true);
    try {
      await Promise.all(dead.map((t) => api(`/api/tasks/${t.id}/retry`, { method: 'POST' })));
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Dead-Letter Queue <span className="text-slate-500 text-sm">({dead.length})</span>
        </h2>
        <div className="flex items-center gap-3">
          <ConnectionDot mode={mode} />
          <button
            disabled={busy || dead.length === 0}
            className="px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-sm font-medium"
            onClick={reprocessAll}
          >
            Reprocess all
          </button>
        </div>
      </div>

      <Card>
        {dead.length === 0 ? (
          <div className="text-sm text-slate-400 py-6 text-center">
            DLQ is empty — no tasks exhausted their retry budget.
          </div>
        ) : (
          <div className="space-y-3">
            {dead.map((t) => (
              <div key={t.id} className="border border-slate-800 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      {t.type} <ShortId id={t.id} />
                    </div>
                    <div className="text-xs text-slate-500">
                      attempts {t.attempt}/{t.maxAttempts} · failed {t.finishedAt ? new Date(t.finishedAt).toLocaleTimeString() : '—'}
                    </div>
                  </div>
                  <button
                    disabled={busy}
                    className="px-2.5 py-1 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-xs font-medium"
                    onClick={() => reprocess(t.id)}
                  >
                    Reprocess
                  </button>
                </div>
                <code className="block mt-2 text-xs text-rose-300 break-all">{t.lastError}</code>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
