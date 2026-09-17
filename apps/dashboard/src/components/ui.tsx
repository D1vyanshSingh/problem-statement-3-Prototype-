import type { ReactNode } from 'react';
import type { TaskStatus } from '../types';

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-4 ${className}`}>
      {title && <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>}
      {children}
    </div>
  );
}

export function StatCard({ label, value, accent = 'text-slate-100', sub }: { label: string; value: ReactNode; accent?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<TaskStatus, string> = {
  scheduled: 'bg-slate-700 text-slate-200',
  pending: 'bg-yellow-600/80 text-yellow-50',
  running: 'bg-sky-600/80 text-sky-50',
  retrying: 'bg-orange-600/80 text-orange-50',
  completed: 'bg-emerald-600/80 text-emerald-50',
  dead_letter: 'bg-rose-700/80 text-rose-50',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-700'}`}>
      {status}
    </span>
  );
}

export function EventBadge({ type }: { type: string }) {
  const style =
    type === 'COMPLETED'
      ? 'bg-emerald-700/40 text-emerald-300'
      : type === 'DEAD_LETTER'
        ? 'bg-rose-700/40 text-rose-300'
        : type === 'RECOVERED'
          ? 'bg-violet-700/40 text-violet-300'
          : type === 'WORKER_TIMEOUT'
            ? 'bg-red-700/40 text-red-300'
            : type === 'RETRY_QUEUED' || type === 'RETRY_NOW'
              ? 'bg-orange-700/40 text-orange-300'
              : 'bg-slate-700/40 text-slate-300';
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${style}`}>{type}</span>;
}

export function ConnectionDot({ mode }: { mode: 'connecting' | 'live' | 'polling' }) {
  const color = mode === 'live' ? 'bg-emerald-400' : mode === 'polling' ? 'bg-amber-400' : 'bg-slate-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <span className={`h-2 w-2 rounded-full ${color} ${mode === 'live' ? 'animate-pulse' : ''}`} />
      {mode === 'live' ? 'live (ws)' : mode === 'polling' ? 'polling fallback' : 'connecting…'}
    </span>
  );
}

export function ShortId({ id }: { id: string }) {
  return <code className="text-[11px] text-slate-500">{id.slice(0, 8)}</code>;
}
