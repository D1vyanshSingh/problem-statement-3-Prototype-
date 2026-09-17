import { useState } from 'react';
import { useSnapshot, api } from '../../store';
import { Panel, Dot, Icon, shortId } from '../../components/kit';
import type { Worker } from '../../types';

/** Workers — fleet overview with deploy/kill controls per node. */

export default function WorkersPage() {
  const s = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');

  const online = s.workers.filter((w) => w.status === 'online');
  const offline = s.workers.filter((w) => w.status === 'offline');
  const shown = filter === 'all' ? s.workers : filter === 'online' ? online : offline;

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

  const deploy = () =>
    run(async () => {
      await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
    });

  const kill = (w: Worker) =>
    run(async () => {
      await api(`/api/admin/chaos/kill-worker/${w.name}`, { method: 'POST' });
    });

  const pause = (w: Worker) =>
    run(async () => {
      await api(`/api/admin/chaos/pause-heartbeats/${w.name}`, { method: 'POST' });
    });

  const heldBy = (w: Worker) => s.tasks.filter((t) => t.assignedWorkerId === w.id && t.status === 'running');

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-200">{error}</div>
      )}

      {/* Control header */}
      <Panel className="p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-wide">Orchestrated Worker Fleet</h2>
          <p className="text-[11px] font-mono text-gray-500">
            {online.length} active nodes • {offline.length} offline • capacity {online.reduce((a, w) => a + w.capacity, 0)} tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-black rounded border border-border p-1 font-mono text-xs">
            {(
              [
                ['all', `All (${s.workers.length})`],
                ['online', `Online (${online.length})`],
                ['offline', `Offline (${offline.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 rounded ${
                  filter === key
                    ? key === 'offline'
                      ? 'text-red-400 bg-panel-hover'
                      : 'text-white bg-panel-hover border border-border'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={deploy}
            disabled={busy}
            className="px-3 py-1.5 bg-red-600 text-white font-mono text-xs font-semibold rounded hover:bg-red-500 disabled:opacity-40 transition-colors flex items-center gap-1 shadow-[0_0_12px_rgba(239,68,68,0.35)]"
          >
            <Icon name="add_circle" className="!text-[16px]" />
            Deploy Worker
          </button>
        </div>
      </Panel>

      {/* Worker cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((w) => {
          const held = heldBy(w);
          const isOnline = w.status === 'online';
          const cap = Math.max(1, w.capacity);
          const util = Math.min(100, (held.length / cap) * 100);
          return (
            <Panel
              key={w.id}
              className={`p-4 flex flex-col justify-between hover:border-red-500/40 transition-all ${!isOnline ? 'border-red-900/70' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Dot color={isOnline ? 'white' : 'red'} pulse={!isOnline} className="!w-2.5 !h-2.5" />
                    <span className="font-mono font-bold text-white text-sm">{w.name}</span>
                  </div>
                  <span className="font-mono text-[10px] bg-black px-2 py-0.5 rounded text-gray-400 border border-border">
                    {shortId(w.id)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-gray-400 mt-2">
                  <span className={isOnline ? 'text-white' : 'text-red-400'}>● {isOnline ? 'Online' : 'Offline'}</span>
                  <span className="text-gray-600">•</span>
                  <span>
                    Heartbeat: <span className="text-gray-200">{w.lastHeartbeatAt.slice(11, 19)}Z</span>
                  </span>
                  <span className="text-gray-600">•</span>
                  <span>PID: {String(w.metadata?.pid ?? '—')}</span>
                </div>
                <div className="mt-4">
                  <div className="flex justify-between font-mono text-[11px] mb-1.5">
                    <span className="text-gray-400">Capacity Utilization</span>
                    <span className={`font-semibold ${util >= 100 ? 'text-red-400' : 'text-white'}`}>
                      {held.length} / {cap} tasks
                    </span>
                  </div>
                  <div className="w-full bg-black h-2 rounded-full overflow-hidden border border-border">
                    <div
                      className={`h-full rounded-full ${util >= 100 ? 'bg-red-500' : held.length > 0 ? 'bg-gray-300' : 'bg-gray-600'}`}
                      style={{ width: `${util}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border font-mono text-[10px] text-gray-400">
                  <div>
                    Leases held: <span className="text-white">{held.length}</span>
                  </div>
                  <div className="text-right">
                    {held.length > 0 ? (
                      <span>
                        {shortId(held[0].id)}
                        {held.length > 1 && ` +${held.length - 1}`}
                      </span>
                    ) : (
                      'idle'
                    )}
                  </div>
                </div>
              </div>
              {isOnline && (
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                  <button
                    onClick={() => pause(w)}
                    disabled={busy}
                    className="flex-1 py-1 px-2 bg-black hover:bg-panel-hover border border-border rounded text-gray-300 font-mono text-xs flex items-center justify-center gap-1 transition-colors disabled:opacity-40"
                  >
                    <Icon name="pause" className="!text-[14px]" /> Pause HB
                  </button>
                  <button
                    onClick={() => kill(w)}
                    disabled={busy}
                    className="py-1 px-2.5 bg-red-950/40 hover:bg-red-900/60 border border-red-900/70 rounded text-red-400 font-mono text-xs flex items-center justify-center gap-1 transition-colors disabled:opacity-40"
                  >
                    <Icon name="power_settings_new" className="!text-[14px]" /> Kill
                  </button>
                </div>
              )}
            </Panel>
          );
        })}

        {/* Add worker card */}
        <button
          onClick={deploy}
          disabled={busy}
          className="bg-black border-2 border-dashed border-border hover:border-red-500 rounded-lg p-6 flex flex-col items-center justify-center text-center transition-all group min-h-[220px] disabled:opacity-40"
        >
          <div className="w-12 h-12 rounded-full bg-panel border border-border group-hover:border-red-500 group-hover:text-red-500 text-gray-400 flex items-center justify-center transition-all">
            <Icon name="add" className="!text-[24px]" />
          </div>
          <span className="font-mono font-semibold text-white mt-3 group-hover:text-red-400 transition-colors text-sm">
            + Add Worker Node
          </span>
          <p className="text-[11px] font-mono text-gray-500 max-w-[200px] mt-1">
            Spawn a real worker process that registers and starts claiming tasks
          </p>
        </button>
      </div>
    </div>
  );
}
