import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import OverviewPage from './pages/OverviewPage';
import WorkersPage from './pages/WorkersPage';
import TasksPage from './pages/TasksPage';
import DlqPage from './pages/DlqPage';
import DemoPage from './pages/DemoPage';
import { startLive } from './store';
import './index.css';

function App() {
  useEffect(() => {
    startLive();
  }, []);
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight">⚡ Relay</span>
              <span className="text-xs text-slate-500">task platform</span>
            </div>
            <nav className="flex gap-1 text-sm">
              {[
                ['/', 'Overview'],
                ['/workers', 'Workers'],
                ['/tasks', 'Tasks'],
                ['/dlq', 'DLQ'],
                ['/demo', 'Demo'],
              ].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md transition ${
                      isActive ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/workers" element={<WorkersPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/dlq" element={<DlqPage />} />
            <Route path="/demo" element={<DemoPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
