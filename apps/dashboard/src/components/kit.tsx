import type { ReactNode } from 'react';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-panel border border-border rounded-lg ${className}`}>{children}</div>;
}

export function Dot({
  color,
  pulse = false,
  className = '',
}: {
  color: 'red' | 'white' | 'gray';
  pulse?: boolean;
  className?: string;
}) {
  const bg = color === 'red' ? 'bg-crimson' : color === 'white' ? 'bg-white' : 'bg-gray-500';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${bg} ${pulse ? 'pulse-live' : ''} ${className}`} />;
}

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono ${className}`}>{children}</span>;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s.toFixed(1)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
