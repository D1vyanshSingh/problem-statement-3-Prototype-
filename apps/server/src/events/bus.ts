import type { Task, TaskEvent, Worker } from '@relay/core';
import type { MetricsSnapshot, QueueSnapshot } from '../repos/tasksMetrics.js';

export interface LiveSnapshot {
  tasks: Task[];
  workers: Worker[];
  queue: QueueSnapshot;
  metrics: MetricsSnapshot;
  events: TaskEvent[];
}

export type LiveEvent =
  | { type: 'task.updated'; task: Task; at: string }
  | { type: 'task.event'; event: TaskEvent; at: string }
  | { type: 'worker.updated'; worker: Worker; at: string }
  | { 'type': 'metrics'; metrics: MetricsSnapshot; at: string };

export type Listener = (e: LiveEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(e: LiveEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* a slow client must never break the emitter */
      }
    }
  }
}
