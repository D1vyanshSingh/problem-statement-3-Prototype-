import { useEffect, useState } from 'react';
import { useSnapshot, useMode, useEventFeed, api } from '../../store';
import { Panel, Dot, Icon, fmt, shortId, timeAgo } from '../../components/kit';
import type { Task, Worker } from '../../types';

/** Overview — live metrics cards, throughput sparkline, queue partitioning, fleet roster. */

function MetricCard({
  label,
  value,
  accent = 'text-white',
  badge,
  sub,
  danger = false,
  onBadgeClick,
}: {
  label: string;
  value: string;
  accent?: string;
  badge?: React.ReactNode;
  sub?: React.ReactNode;
  danger?: boolean;
  onBadgeClick?: () => void;
}) {
  return (
    <Panel className={`p-3.5 flex flex-col justify-between hover:border-red-500/40 transition-colors ${danger ? 'border-red-900/60 hover:border-red-600' : ''}`}>
      <div className="flex items-center justify-between text-gray-400 text-[11px]">
        <span className={danger ? 'text-red-400 font-medium' : ''}>{label}</span>
        {badge}
      </div>
      <div className={`font-mono text-xl font-bold my-1 ${accent}`}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-gray-400">{sub}</div>}
    </Panel>
  );
}

/** Throughput sparkline: ops/sec sampled from live events (2s buckets, 30m window). */
function ThroughputChart({ events }: { events: { createdAt: string; type: string }[] }) {
  const [buckets, setBuckets] = useState<number[]>(() => new Array(60).fill(0));

  useEffect(() => {
    const relevant = events.filter((e) => ['LEASED', 'COMPLETED', 'RECOVERED'].includes(e.type));
    const now = Date.now();
    const next = new Array(60).fill(0);
    for (const e of relevant) {
      const ageSec = (now - new Date(e.createdAt).getTime()) / 1000;
      if (ageSec < 0 || ageSec > 120) continue;
      const idx = 59 - Math.floor(ageSec / 2);
      next[idx] += 1;
    }
    setBuckets(next);
  }, [events]);

  const max = Math.max(4, ...buckets);
  const w = 700;
  const h = 180;
  const step = w / (buckets.length - 1);
  const pts = buckets.map((v, i) => `${i * step},${h - (v / max) * (h - 20) - 10}`);
  const line = pts.length > 1 ? `M ${pts.join(' L ')}` : '';
  const area = `${line} L ${w},${h} L 0,${h} Z`;
  const last = buckets[buckets.length - 1] ?? 0;

  return (
    <Panel className="lg:col-span-2 p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white tracking-wide">Throughput Ingestion &amp; Dispatch</h3>
          <p className="text-[11px] font-mono text-gray-500">Live ops/sec, last 2 minutes (2s resolution)</p>
        </div>
        <div className="flex items-center gap-1.5 bg-black p-1 rounded border border-border text-[11px] font-mono">
          <button className="px-2 py-0.5 rounded bg-panel-hover text-white border border-red-500/60">Live</button>
          <button className="px-2 py-0.5 rounded text-gray-500 cursor-default">15m</button>
          <button className="px-2 py-0.5 rounded text-gray-500 cursor-default">1h</button>
          <button className="px-2 py-0.5 rounded text-gray-500 cursor-default">24h</button>
        </div>
      </div>
      <div className="w-full h-48 relative">
        <svg className="w-full h-full" preserveAspectRatio="none" viewBox={`0 0 ${w} ${h}`}>
          <defs>
            <linearGradient id="red-chart-gradient" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0.38" />
              <stop offset="60%" stopColor="#EF4444" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[36, 72, 108, 144].map((y) => (
            <line key={y} stroke="#22252B" strokeDasharray="3 3" x1="0" x2={w} y1={y} y2={y} />
          ))}
          {area && <path d={area} fill="url(#red-chart-gradient)" />}
          {line && <path d={line} fill="none" stroke="#EF4444" strokeWidth="2.2" />}
        </svg>
        <div className="absolute right-3 top-2 flex items-center gap-1.5 font-mono text-[11px] text-white bg-black/90 px-2 py-0.5 rounded border border-border">
          <Dot color="red" pulse />
          CURRENT: {last} ops/2s
        </div>
      </div>
      <div className="flex justify-between font-mono text-[10px] text-gray-500 pt-2 border-t border-border mt-2">
        <span>-2m</span>
        <span>-90s</span>
        <span>-60s</span>
        <span>-30s</span>
        <span className="text-white font-semibold">NOW</span>
      </div>
    </Panel>
  );
}

export default function OverviewPage() {
  const s = useSnapshot();
  const mode = useMode();
  const feed = useEventFeed(300);

  const q = s.queue.byStatus;
  const m = s.metrics;
  const now = Date.now();

  const online = s.workers.filter((w) => w.status === 'online');
  const offline = s.workers.filter((w) => w.status === 'offline');
  const runningTotal = q.running ?? 0;
  const totalTasks = Object.values(q).reduce((a, b) => a + b, 0);
  const capacity = online.reduce((a, w) => a + w.capacity, 0) || 1;

  const statusOf = (w: Worker): Task[] =>
    s.tasks.filter((t) => t.assignedWorkerId === w.id && t.status === 'running');

  return (
    <div className="space-y-6">
      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MetricCard
          label="Queue Depth"
          value={fmt((q.pending ?? 0) + (q.retrying ?? 0) + (q.scheduled ?? 0))}
          sub={
            <span className="flex justify-between">
              <span>Cap: {fmt(capacity * 10)}</span>
              <span className="text-white font-medium">
                {capacity ? Math.round((runningTotal / capacity) * 100) : 0}%
              </span>
            </span>
          }
        />
        <MetricCard
          label="Running"
          value={fmt(runningTotal)}
          badge={<Dot color="red" pulse />}
          sub={<span><span className="text-white font-medium">{online.length}</span> workers active</span>}
        />
        <MetricCard label="Completed" value={fmt(m.completedTotal)} sub={`${m.successRatePct ?? 100}% success rate`} />
        <MetricCard label="Failed" value={fmt(m.failedTotal)} accent="text-red-500" sub="Dead-lettered total" danger />
        <MetricCard label="Retries" value={fmt(m.retriedTotal)} accent="text-red-400" sub="Backoff re-queues" />
        <MetricCard label="Recoveries" value={fmt(m.recoveredTotal)} sub="Leases auto-healed" />
        <MetricCard
          label="DLQ Size"
          value={fmt(m.dlqSize)}
          danger
          badge={<Icon name="warning" className="!text-[14px] text-red-500" />}
          sub={
            <span className="flex justify-between w-full">
              <span>Unresolved</span>
              <a href="/dlq" className="text-red-400 hover:text-white underline">View</a>
            </span>
          }
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ThroughputChart events={feed} />

        {/* Queue Partitioning */}
        <Panel className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white tracking-wide">Queue Partitioning</h3>
              <span className="font-mono text-[10px] text-gray-500">BY STATUS</span>
            </div>
            <p className="text-[11px] font-mono text-gray-500 mb-4">Task distribution across state pipelines</p>
            <div className="space-y-3.5 font-mono text-xs">
              {(
                [
                  ['Running', q.running ?? 0, 'bg-white', 'text-white'],
                  ['Scheduled', q.scheduled ?? 0, 'bg-gray-400', 'text-gray-300'],
                  ['Pending', q.pending ?? 0, 'bg-gray-600', 'text-gray-400'],
                  ['Retrying', q.retrying ?? 0, 'bg-red-400', 'text-red-400'],
                  ['Dead Letter (DLQ)', q.dead_letter ?? 0, 'bg-red-600', 'text-red-500 font-bold'],
                ] as const
              ).map(([label, v, bar, text]) => {
                const pct = totalTasks ? (v / totalTasks) * 100 : 0;
                return (
                  <div key={label}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className={`${text} flex items-center gap-1.5 font-medium`}>
                        <span className={`w-2 h-2 rounded-full ${bar}`} /> {label}
                      </span>
                      <span className="text-white font-semibold">
                        {fmt(v)} <span className="text-gray-500 font-normal">({pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="w-full bg-black h-2 rounded-full overflow-hidden border border-border">
                      <div className={`${bar} h-full rounded-full`} style={{ width: `${Math.max(pct, v > 0 ? 2 : 0)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="p-2.5 bg-black border border-border rounded mt-4 flex items-center justify-between text-[11px] font-mono">
            <span className="text-gray-400">Orchestrator Heartbeat</span>
            <span className="text-white flex items-center gap-1">
              <Dot color={mode === 'live' ? 'white' : 'red'} pulse={mode !== 'live'} />{' '}
              {mode === 'live' ? 'NOMINAL (ws)' : mode === 'polling' ? 'POLLING FALLBACK' : 'CONNECTING'}
            </span>
          </div>
        </Panel>
      </div>

      {/* Fleet roster */}
      <Panel className="p-5 space-y-4 font-mono">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-black border border-border flex items-center justify-center text-red-500">
              <Icon name="memory" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-wide font-sans flex items-center gap-2">
                Worker Fleet Lifecycle &amp; Status
              </h3>
              <p className="text-[11px] text-gray-500">
                Real-time worker lifecycle tracking and heartbeat watchdog
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[11px] text-gray-400">AUTO-FAILOVER:</span>
            <span className="px-2 py-0.5 rounded bg-black border border-border text-white flex items-center gap-1.5 text-[11px]">
              <Dot color="white" pulse /> ACTIVE
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-black border border-border rounded-lg p-3.5">
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span className="flex items-center gap-1.5 text-white font-medium">
                <Dot color="white" pulse /> Active / Working
              </span>
              <span className="text-white font-mono text-[10px] bg-panel-hover px-1.5 py-0.5 rounded border border-border">
                {online.length ? Math.round((online.length / Math.max(1, s.workers.length)) * 100) : 0}%
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-white">
                {online.length} <span className="text-xs font-normal text-gray-500">nodes</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">Processing {fmt(runningTotal)} active task leases</p>
            </div>
            <div className="w-full bg-panel-hover h-1.5 rounded-full overflow-hidden border border-border">
              <div
                className="bg-white h-full"
                style={{ width: `${(online.length / Math.max(1, s.workers.length)) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-black border border-red-900/60 rounded-lg p-3.5">
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span className="flex items-center gap-1.5 text-red-400 font-medium">
                <Dot color="red" pulse /> Dead / Terminated
              </span>
              <span className="text-red-400 font-mono text-[10px] bg-red-950/80 px-1.5 py-0.5 rounded border border-red-800/80">
                {offline.length} FAILED
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-red-500">
                {offline.length} <span className="text-xs font-normal text-gray-500">nodes</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">Heartbeat loss detected</p>
            </div>
            <div className="w-full bg-panel-hover h-1.5 rounded-full overflow-hidden border border-border">
              <div
                className="bg-red-500 h-full"
                style={{ width: `${(offline.length / Math.max(1, s.workers.length)) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-black border border-border rounded-lg p-3.5">
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span className="flex items-center gap-1.5 text-gray-300 font-medium">
                <Dot color="gray" /> Recovered Tasks
              </span>
              <span className="text-gray-300 font-mono text-[10px] bg-panel-hover px-1.5 py-0.5 rounded border border-border">
                {m.recoveredTotal} RECOVERED
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-gray-200">
                {fmt(m.recoveredTotal)} <span className="text-xs font-normal text-gray-500">tasks</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">Stale leases reclaimed &amp; reassigned</p>
            </div>
            <div className="w-full bg-panel-hover h-1.5 rounded-full overflow-hidden border border-border">
              <div className="bg-gray-400 h-full" style={{ width: '100%' }} />
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-black overflow-hidden">
          <div className="px-3.5 py-2 bg-panel-hover border-b border-border flex items-center justify-between text-[11px] text-gray-400">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Icon name="dns" className="!text-[15px] text-red-500" /> Worker Nodes Detailed Lifecycle Roster
            </span>
            <span className="text-gray-500">
              {s.workers.length} Total Monitored Units ({online.length} Online • {offline.length} Offline)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="text-[11px] text-gray-500 border-b border-border bg-black">
                  <th className="py-2 px-3">NODE IDENTIFIER</th>
                  <th className="py-2 px-3">LIFECYCLE STATUS</th>
                  <th className="py-2 px-3">HOST / PID</th>
                  <th className="py-2 px-3">ACTIVE LEASES</th>
                  <th className="py-2 px-3">HEARTBEAT</th>
                  <th className="py-2 px-3 text-right">HEALTH</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-[11px]">
                {s.workers.map((w) => {
                  const held = statusOf(w);
                  const isOnline = w.status === 'online';
                  return (
                    <tr key={w.id} className={`hover:bg-panel transition-colors ${!isOnline ? 'bg-red-950/20 border-l-2 border-red-500' : ''}`}>
                      <td className={`py-2.5 px-3 font-semibold flex items-center gap-2 ${isOnline ? 'text-white' : 'text-red-400'}`}>
                        <Dot color={isOnline ? 'white' : 'red'} pulse={!isOnline} />
                        {w.name}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium inline-flex items-center gap-1 ${
                            isOnline
                              ? 'bg-panel-hover border border-gray-600 text-white'
                              : 'bg-red-950/80 border border-red-800 text-red-400 font-bold'
                          }`}
                        >
                          <Dot color={isOnline ? 'white' : 'red'} pulse={!isOnline} />
                          {isOnline ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-400">
                        pid {String(w.metadata?.pid ?? '—')}
                      </td>
                      <td className={`py-2.5 px-3 font-medium ${isOnline ? 'text-white' : 'text-red-400'}`}>
                        {held.length > 0 ? `${held.length} task${held.length > 1 ? 's' : ''}` : '0'}
                        {!isOnline && held.length === 0 && ' (revoked)'}
                      </td>
                      <td className={`py-2.5 px-3 ${isOnline ? 'text-gray-300' : 'text-red-400 font-semibold'}`}>
                        {timeAgo(w.lastHeartbeatAt, now)}
                        {!isOnline && ' (LOST)'}
                      </td>
                      <td className={`py-2.5 px-3 text-right ${isOnline ? 'text-gray-400' : 'text-red-400 font-semibold'}`}>
                        {isOnline ? 'Nominal' : 'Heartbeat Timeout'}
                      </td>
                    </tr>
                  );
                })}
                {s.workers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-gray-500">
                      No workers registered. Deploy one from the Workers tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export { shortId };
