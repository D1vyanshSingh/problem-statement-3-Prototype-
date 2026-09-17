export const TASK_STATUSES = [
  'scheduled',
  'pending',
  'running',
  'retrying',
  'completed',
  'dead_letter',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type WorkerStatus = 'online' | 'offline';

export interface Task {
  id: string;
  type: string;
  status: TaskStatus;
  priority: number;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  assignedWorkerId: string | null;
  leaseToken: string | null;
  attempt: number;
  maxAttempts: number;
  runAt: string;
  leaseExpiresAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Worker {
  id: string;
  name: string;
  status: WorkerStatus;
  capacity: number;
  lastHeartbeatAt: string;
  registeredAt: string;
  offlineAt: string | null;
  metadata: Record<string, unknown>;
}

export interface TaskEvent {
  id: number;
  taskId: string | null;
  workerId: string | null;
  type: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface CreateTaskInput {
  type: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  scheduledAt?: Date;
  priority?: number;
}

export { backoffMs } from './backoff.js';
export { planSeedMix, seedMixSummary, DEMO_TYPES } from './seed.js';
export type { SeedPlanItem, SeedMix } from './seed.js';
