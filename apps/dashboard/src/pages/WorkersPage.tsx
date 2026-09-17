import { useSnapshot, useMode, api } from '../store';
import { Card, ConnectionDot } from '../components/ui';
import { ShortId } from '../components/ui';
import type { Worker } from '../types';

function heartbeatAge(w: Worker): string {
  const s = Math.max(0, (Date.now() - new Date(w.lastHeartbeatAt).getTime()) / 1000);
  return s < 60 ? `${s.toFixed(0)}s ago` : `${Math.round(s / 60)}m ago`;
}

export default function WorkersPage() {
  const s = useSnapshot();
  const mode = useMode();
  const runningBy = s.queue.runningByWorker ?? {};

  const chaosAct = (path: string) => api(path, { method: 'POST' }).catch((e) => alert(String(e)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Workers</h2>
        <div className="flex items-center gap-3">
          <ConnectionDot mode={mode} />
          <button
            className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-sm font-medium"
            onClick={() => chaosAct('/api/admin/chaos/spawn-worker')}
          >
            + Add worker
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {s.workers.map((w) => {
          const running = runningBy[w.id] ?? 0;
          const isChaos = w.name.startsWith('chaos-worker-');
          const online = w.status === 'online';
          return (
            <Card key={w.id}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                    {w.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    <ShortId id={w.id} /> · pid {String(w.metadata?.pid ?? '?')} · heartbeat {heartbeatAge(w)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${online ? 'bg-emerald-800/60 text-emerald-300' : 'bg-rose-900/60 text-rose-300'}`}>
                  {w.status}
                </span>
              </div>

              <div className="text-xs text-slate-400 mb-1">
                busy {running}/{w.capacity}
              </div>
              <div className="h-2 rounded bg-slate-800 mb-3">
                <div
                  className={`h-2 rounded ${running >= w.capacity ? 'bg-orange-500' : 'bg-sky-500'}`}
                  style={{ width: `${Math.min(100, (running / Math.max(1, w.capacity)) * 100)}%` }}
                />
              </div>

              {isChaos && (
                <div className="flex gap-2">
                  <button
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                    onClick={() => chaosAct(`/api/admin/chaos/pause-heartbeats/${w.name}`)}
                  >
                    Pause heartbeats
                  </button>
                  <button
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                    onClick={() => chaosAct(`/api/admin/chaos/resume-heartbeats/${w.name}`)}
                  >
                    Resume
                  </button>
                  <button
                    className="px-2 py-1 rounded bg-rose-900/70 hover:bg-rose-800 text-xs"
                    onClick={() => chaosAct(`/api/admin/chaos/kill-worker/${w.name}`)}
                  >
                    Kill (SIGKILL)
                  </button>
                </div>
              )}
            </Card>
          );
        })}
        {s.workers.length === 0 && (
          <Card>
            <div className="text-sm text-slate-400">No workers registered yet — add one above.</div>
          </Card>
        )}
      </div>
    </div>
  );
}
