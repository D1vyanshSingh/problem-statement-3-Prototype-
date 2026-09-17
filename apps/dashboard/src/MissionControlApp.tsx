import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useSnapshot, useMode, useEventFeed, startLive } from './store';
import { Dot, Icon, fmt } from './components/kit';
import OverviewPage from './pages/kit/OverviewPage';
import WorkersPage from './pages/kit/WorkersPage';
import TasksPage from './pages/kit/TasksPage';
import DlqPage from './pages/kit/DlqPage';
import ChaosPage from './pages/kit/ChaosPage';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'speed', path: '/' },
  { key: 'workers', label: 'Workers', icon: 'memory', path: '/workers' },
  { key: 'tasks', label: 'Tasks', icon: 'account_tree', path: '/tasks' },
  { key: 'dlq', label: 'DLQ', icon: 'warning', path: '/dlq' },
  { key: 'demo', label: 'Chaos Demo', icon: 'terminal', path: '/demo' },
] as const;

function Shell() {
  const s = useSnapshot();
  const mode = useMode();
  const feed = useEventFeed(50);
  const navigate = useNavigate();
  const location = useLocation();
  const active = TABS.find((t) => t.path === location.pathname)?.key ?? 'overview';

  useEffect(() => {
    startLive();
  }, []);

  const online = s.workers.filter((w) => w.status === 'online').length;
  const dlq = s.metrics.dlqSize;
  const recentOps = feed.filter((e) => ['LEASED', 'COMPLETED'].includes(e.type)).length;

  return (
    <div className="bg-black text-gray-200 font-sans antialiased min-h-screen flex selection:bg-red-950 selection:text-red-300">
      {/* Sidebar */}
      <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col justify-between shrink-0 h-screen sticky top-0 z-40 select-none">
        <div>
          <div className="h-14 px-4 flex items-center gap-2.5 border-b border-border bg-black">
            <div className="w-7 h-7 rounded-lg bg-panel border border-border flex items-center justify-center font-mono font-bold text-sm shadow-[0_0_14px_rgba(239,68,68,0.4)]">
              <Icon name="bolt" className="!text-[18px] text-red-500" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono font-bold tracking-tight text-white text-base">VITALS</span>
              <span className="text-[10px] font-mono text-gray-500 tracking-wider">v2.4</span>
            </div>
          </div>
          <nav className="p-2 space-y-1 mt-2">
            {TABS.map((t) => {
              const isActive = active === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => navigate(t.path)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all border-l-2 ${
                    isActive
                      ? 'text-red-400 bg-panel border-red-500'
                      : 'text-gray-400 hover:text-white hover:bg-panel border-transparent'
                  }`}
                >
                  <Icon name={t.icon} className="!text-[18px]" />
                  <span className="flex-1 text-left">{t.label}</span>
                  {t.key === 'workers' && (
                    <span className="font-mono text-[10px] bg-panel-hover text-gray-300 px-1.5 py-0.5 rounded border border-border">
                      {online}
                    </span>
                  )}
                  {t.key === 'tasks' && (
                    <span className="font-mono text-[10px] bg-panel-hover text-gray-300 px-1.5 py-0.5 rounded border border-border">
                      {fmt(s.queue.byStatus.pending ?? 0)}
                    </span>
                  )}
                  {t.key === 'dlq' && dlq > 0 && (
                    <span className="font-mono text-[10px] bg-red-950/80 border border-red-800/80 text-red-400 px-1.5 py-0.5 rounded font-semibold">
                      {dlq}
                    </span>
                  )}
                  {t.key === 'demo' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 ml-auto pulse-live" />}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="p-3 border-t border-border bg-black">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-gray-500">Connection</span>
            <span className="inline-flex items-center gap-1.5 text-white font-medium bg-panel px-2 py-0.5 rounded border border-border">
              <Dot color={mode === 'live' ? 'red' : 'gray'} pulse={mode === 'live'} />
              {mode === 'live' ? 'Live (WS)' : mode === 'polling' ? 'Polling' : 'Connecting…'}
            </span>
          </div>
          <div className="mt-2 text-[10px] text-gray-500 font-mono flex justify-between">
            <span>Postgres backend</span>
            <span className="text-gray-400">{recentOps} ops/min</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 bg-black">
        <header className="h-14 px-6 border-b border-border bg-bg-secondary/90 backdrop-blur sticky top-0 z-30 flex items-center justify-between gap-4">
          <h1 className="font-semibold text-sm text-white tracking-wide flex items-center gap-2">
            <span>Mission Control</span>
            <span className="text-gray-600 font-normal">/</span>
            <span className="text-red-400 font-mono text-xs font-normal capitalize">{active}</span>
          </h1>
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="hidden sm:flex items-center gap-2 bg-panel px-2.5 py-1 rounded border border-border">
              <span className="text-gray-500 text-[11px]">THROUGHPUT:</span>
              <span className="text-white font-semibold flex items-center gap-0.5">
                <Icon name="bolt" className="!text-[14px] text-red-500" />
                {recentOps} <span className="text-gray-500 font-normal text-[10px]">ops/min</span>
              </span>
            </div>
            <div className="flex items-center gap-2 bg-panel px-2.5 py-1 rounded border border-border">
              <span className="text-gray-500 text-[11px]">DLQ:</span>
              <span className="text-red-400 font-semibold flex items-center gap-1">
                <Dot color={dlq > 0 ? 'red' : 'gray'} pulse={dlq > 0} />
                {dlq} <span className="text-gray-500 font-normal text-[10px]">tasks</span>
              </span>
            </div>
            <div className="hidden md:flex items-center gap-2 bg-panel px-2.5 py-1 rounded border border-border">
              <span className="text-gray-500 text-[11px]">RECOVERIES:</span>
              <span className="text-white font-semibold">{s.metrics.recoveredTotal}</span>
            </div>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-y-auto space-y-6">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/workers" element={<WorkersPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/dlq" element={<DlqPage />} />
            <Route path="/demo" element={<ChaosPage />} />
            <Route path="*" element={<OverviewPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function MissionControlApp() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
