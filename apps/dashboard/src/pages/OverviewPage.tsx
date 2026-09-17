import { useSnapshot, useMode } from '../store';
import { StatCard, Card, ConnectionDot, EventBadge, ShortId } from '../components/ui';

export default function OverviewPage() {
  const s = useSnapshot();
  const mode = useMode();
  const m = s.metrics;
  const b = m.byStatus;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">System overview</h2>
        <ConnectionDot mode={mode} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Queue depth" value={(b.pending ?? 0) + (b.retrying ?? 0)} sub={`${b.scheduled ?? 0} scheduled`} />
        <StatCard label="Running" value={b.running ?? 0} accent="text-sky-300" sub={`${m.workers.online} workers online`} />
        <StatCard label="Completed" value={m.completedTotal} accent="text-emerald-300" />
        <StatCard label="Dead-lettered" value={m.failedTotal} accent="text-rose-300" sub={`DLQ size ${m.dlqSize}`} />
        <StatCard label="Retries" value={m.retriedTotal} accent="text-orange-300" />
        <StatCard label="Recoveries" value={m.recoveredTotal} accent="text-violet-300" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Queue by status" className="lg:col-span-1">
          <div className="space-y-2">
            {(['scheduled', 'pending', 'running', 'retrying', 'completed', 'dead_letter'] as const).map((k) => {
              const v = b[k] ?? 0;
              const total = Object.values(b).reduce((a, c) => a + c, 0) || 1;
              return (
                <div key={k}>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                  <div className="h-1.5 rounded bg-slate-800">
                    <div className="h-1.5 rounded bg-sky-500" style={{ width: `${(v / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Throughput & health">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-slate-500 text-xs uppercase">Completions / min</div>
              <div className="text-xl font-bold">{m.throughputPerMin}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Success rate</div>
              <div className="text-xl font-bold">{m.successRatePct ?? '—'}{m.successRatePct !== null ? '%' : ''}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Workers online</div>
              <div className="text-xl font-bold">{m.workers.online}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Workers offline</div>
              <div className="text-xl font-bold">{m.workers.offline}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Oldest pending</div>
              <div className="text-xl font-bold">
                {s.queue.oldestPendingSeconds !== null ? `${Math.round(s.queue.oldestPendingSeconds)}s` : '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Tracked tasks</div>
              <div className="text-xl font-bold">{Object.values(b).reduce((a, c) => a + c, 0)}</div>
            </div>
          </div>
        </Card>

        <Card title="Recent events">
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {s.events.slice(-30).reverse().map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs py-0.5">
                <span className="text-slate-500 w-16 shrink-0">{new Date(e.createdAt).toLocaleTimeString()}</span>
                <EventBadge type={e.type} />
                {e.taskId && <ShortId id={e.taskId} />}
              </div>
            ))}
            {s.events.length === 0 && <div className="text-xs text-slate-500">No events yet.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
