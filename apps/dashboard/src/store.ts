import { useEffect, useState } from 'react';
import type { LiveMessage, Snapshot, TaskEvent } from './types';

type Mode = 'connecting' | 'live' | 'polling';

const listeners = new Set<(s: Snapshot) => void>();
const modeListeners = new Set<(m: Mode) => void>();
const eventListeners = new Set<(e: TaskEvent) => void>();

let snapshot: Snapshot = {
  tasks: [],
  workers: [],
  queue: { byStatus: {}, oldestPendingSeconds: null, running: 0, runningByWorker: {} },
  metrics: {
    ts: '',
    byStatus: {},
    workers: { online: 0, offline: 0 },
    completedTotal: 0,
    failedTotal: 0,
    retriedTotal: 0,
    recoveredTotal: 0,
    dlqSize: 0,
    throughputPerMin: 0,
    successRatePct: null,
  },
  events: [],
};
let mode: Mode = 'connecting';
let ws: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let eventRing: TaskEvent[] = [];
let started = false;

function emitAll(): void {
  for (const fn of listeners) fn(snapshot);
}
function emitMode(): void {
  for (const fn of modeListeners) fn(mode);
}
function emitEvent(e: TaskEvent): void {
  for (const fn of eventListeners) fn(e);
}

function handleMessage(msg: LiveMessage): void {
  if (msg.type === 'snapshot') {
    snapshot = msg.payload;
    eventRing = [...msg.payload.events];
  } else if (msg.type === 'task.updated') {
    const t = msg.payload.task;
    const idx = snapshot.tasks.findIndex((x) => x.id === t.id);
    const tasks = [...snapshot.tasks];
    if (idx >= 0) tasks[idx] = t;
    else tasks.unshift(t);
    snapshot = { ...snapshot, tasks: tasks.slice(0, 400) };
  } else if (msg.type === 'task.event') {
    eventRing = [...eventRing.slice(-499), msg.payload.event];
    emitEvent(msg.payload.event);
  } else if (msg.type === 'worker.updated') {
    const w = msg.payload.worker;
    const idx = snapshot.workers.findIndex((x) => x.id === w.id);
    const workers = [...snapshot.workers];
    if (idx >= 0) workers[idx] = w;
    else workers.push(w);
    snapshot = { ...snapshot, workers };
  } else if (msg.type === 'metrics') {
    snapshot = { ...snapshot, metrics: msg.payload.metrics };
  }
  emitAll();
}

async function pollOnce(): Promise<void> {
  try {
    const [tasksRes, metricsRes] = await Promise.all([
      fetch('/api/tasks?limit=200'),
      fetch('/api/metrics'),
    ]);
    const tasks = await tasksRes.json();
    const metrics = await metricsRes.json();
    snapshot = { ...snapshot, tasks, metrics };
    emitAll();
  } catch {
    /* server down; keep last known */
  }
}

function startPolling(): void {
  if (pollTimer) return;
  mode = 'polling';
  emitMode();
  void pollOnce();
  pollTimer = setInterval(pollOnce, 3000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retryDelay = 1000;
    stopPolling();
    mode = 'live';
    emitMode();
  };
  ws.onmessage = (ev) => {
    try {
      handleMessage(JSON.parse(ev.data as string) as LiveMessage);
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => {
    mode = 'connecting';
    emitMode();
    startPolling();
    scheduleReconnect();
  };
  ws.onerror = () => ws?.close();
}

function scheduleReconnect(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 10_000);
}

export function startLive(): void {
  if (started) return;
  started = true;
  connect();
  startPolling(); // until first ws open
}

export function useSnapshot(): Snapshot {
  const [s, setS] = useState(snapshot);
  useEffect(() => {
    listeners.add(setS);
    setS(snapshot);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export function useMode(): Mode {
  const [m, setM] = useState(mode);
  useEffect(() => {
    modeListeners.add(setM);
    setM(mode);
    return () => {
      modeListeners.delete(setM);
    };
  }, []);
  return m;
}

export function useEventFeed(max = 100): TaskEvent[] {
  const [events, setEvents] = useState<TaskEvent[]>(eventRing.slice(-max));
  useEffect(() => {
    const bump = () => setEvents(eventRing.slice(-max));
    eventListeners.add(bump);
    return () => {
      eventListeners.delete(bump);
    };
  }, [max]);
  return events;
}

export function api<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<T>;
  });
}
