import { useEffect, useRef, useState } from 'react';
import { useSnapshot, useMode, useEventFeed, api } from '../store';
import { Card, ConnectionDot, EventBadge, ShortId, StatusBadge } from '../components/ui';
import type { Task } from '../types';

type Phase = 'idle' | 'seeding' | 'running' | 'done';

const CHAIN = [
  { key: 'WORKER_TIMEOUT', label: 'FAILURE DETECTION' },
  { key: 'RECOVERED', label: 'TASK RECOVERY' },
  { key: 'LEASED', label: 'TASK REASSIGNMENT' },
  { key: 'COMPLETED', label: 'SUCCESSFUL EXECUTION' },
] as const;

export default function DemoPage() {
  const s = useSnapshot();
  const mode = useMode();
  const feed = useEventFeed(200);
  const [phase, setPhase] = useState<Phase>('idle');
  const [victim, setVictim] = useState<string | null>(null);
  const [crashTaskId, setCrashTaskId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const push = (line: string) => setLog((l) => [...l.slice(-100), `${new Date().toLocaleTimeString()}  ${line}`]);

  const start = async () => {
    setPhase('seeding');
    setLog([]);
    setElapsed(0);
    setVictim(null);
    setCrashTaskId(null);
    try {
      push('resetting system…');
      await api('/api/admin/chaos/reset', { method: 'POST' });
      // spawn 2 healthy workers, then the victim
      push('spawning workers…');
      await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
      await new Promise((r) => setTimeout(r, 500));
      const victimRes = await api<{ name: string }>('/api/admin/chaos/spawn-worker', { method: 'POST' });
      setVictim(victimRes.name);
      await new Promise((r) => setTimeout(r, 2500));

      push('seeding deterministic task mix (seed=42, one crash task)…');
      const seedRes = await api<{ scheduled: number; mix: Record<string, number> }>(
        '/api/admin/chaos/seed-tasks',
        { method: 'POST', body: JSON.stringify({ count: 24, seed: 42, crashCount: 1 }) },
      );
      push(`seeded ${seedRes.scheduled} tasks: ${JSON.stringify(seedRes.mix)}`);
      const allTasks = await api<Task[]>('/api/tasks?limit=200');
      const crashTask = allTasks.find((t) => t.type === 'demo.crash');
      setCrashTaskId(crashTask?.id ?? null);
      if (crashTask) push(`crash task ${crashTask.id.slice(0, 8)} in the mix — it will hard-kill the worker holding it`);

      setPhase('running');
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      push('watching for worker failure → detection → recovery…');
    } catch (e) {
      push(`error: ${String(e)}`);
      setPhase('idle');
    }
  };

  // Detect the crash: a WORKER_TIMEOUT event ends the "waiting" phase.
  useEffect(() => {
    if (phase !== 'running') return;
    const timeoutEvt = feed.find((e) => e.type === 'WORKER_TIMEOUT');
    if (timeoutEvt && victim) {
      push(`WORKER FAILURE detected on ${victim} (heartbeat timeout)`);
      setPhase('done');
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [feed, phase, victim]);

  useEffect(() => {
    if (phase !== 'done' || !crashTaskId) return;
    const t = s.tasks.find((x) => x.id === crashTaskId);
    if (t?.status === 'completed') push(`crash task ${crashTaskId.slice(0, 8)} COMPLETED on another worker ✔`);
  }, [phase, crashTaskId, s.tasks]);

  const chainReached = (key: string): boolean => {
    if (key === 'WORKER_TIMEOUT') return feed.some((e) => e.type === 'WORKER_TIMEOUT');
    if (key === 'RECOVERED') return feed.some((e) => e.type === 'RECOVERED');
    if (key === 'LEASED') return feed.some((e) => e.type === 'LEASED' && e.detail?.attempt === 2);
    if (key === 'COMPLETED') {
      return crashTaskId ? s.tasks.find((x) => x.id === crashTaskId)?.status === 'completed' : feed.some((e) => e.type === 'COMPLETED');
    }
    return false;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Guided failure demo</h2>
        <ConnectionDot mode={mode} />
      </div>

      <Card>
        <p className="text-sm text-slate-400 mb-3">
          One click runs the full story: seed deterministic tasks → a worker crashes mid-task (real SIGKILL)
          → heartbeat timeout detected → lease expires → task recovered → reassigned → completed.
          Everything below updates live.
        </p>
        <button
          onClick={start}
          disabled={phase === 'seeding' || phase === 'running'}
          className="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 font-medium"
        >
          {phase === 'idle' ? 'Run failure→recovery demo' : phase === 'done' ? 'Re-run demo' : 'Demo running…'}
        </button>
        {phase === 'running' && <span className="ml-3 text-sm text-slate-400">{elapsed}s elapsed</span>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Recovery chain">
          <div className="space-y-2">
            {[
              { label: 'WORKER FAILURE (SIGKILL)', done: phase !== 'idle' && phase !== 'seeding' },
              ...CHAIN.map((c) => ({ label: c.label, done: chainReached(c.key) })),
            ].map((step) => (
              <div key={step.label} className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${step.done ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                <span className={step.done ? 'text-slate-200' : 'text-slate-500'}>{step.label}</span>
                {step.done && <span className="text-emerald-400 text-xs ml-auto">✓</span>}
              </div>
            ))}
          </div>
          {crashTaskId && (
            <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2 text-sm">
              <span className="text-slate-500">crash task:</span>
              <ShortId id={crashTaskId} />
              {s.tasks.find((x) => x.id === crashTaskId) && (
                <StatusBadge status={s.tasks.find((x) => x.id === crashTaskId)!.status} />
              )}
            </div>
          )}
        </Card>

        <Card title="Live event feed">
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {feed.slice(-40).reverse().map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs py-0.5">
                <span className="text-slate-500 w-16 shrink-0">{new Date(e.createdAt).toLocaleTimeString()}</span>
                <EventBadge type={e.type} />
                {e.taskId && <ShortId id={e.taskId} />}
              </div>
            ))}
            {feed.length === 0 && <div className="text-xs text-slate-500">Waiting for events…</div>}
          </div>
        </Card>
      </div>

      <Card title="Demo log">
        <div className="font-mono text-xs space-y-0.5 max-h-56 overflow-y-auto">
          {log.map((l, i) => (
            <div key={i} className="text-slate-300">{l}</div>
          ))}
          {log.length === 0 && <div className="text-slate-500">Click the button to begin.</div>}
        </div>
      </Card>
    </div>
  );
}
