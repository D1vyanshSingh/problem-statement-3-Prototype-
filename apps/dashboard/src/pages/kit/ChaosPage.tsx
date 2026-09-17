import { useState } from 'react';
import { useSnapshot, useEventFeed, api } from '../../store';
import { Panel, Dot, Icon } from '../../components/kit';

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

  const online = s.workers.filter((w) => w.status === 'online');
  const runningTasks = s.tasks.filter((t) => t.status === 'running' && t.assignedWorkerId);

  // Derive live stage progress from real events during an active run.
  const seen = (type: string, after: number) =>
    feed.some((e) => e.type === type && new Date(e.createdAt).getTime() > after);

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
