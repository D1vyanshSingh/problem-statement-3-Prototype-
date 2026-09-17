export type TaskStatus =
  | 'scheduled'
  | 'pending'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'dead_letter';

export interface Task {
  id: string;
  type: string;
  status: TaskStatus;
  priority: number;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  assignedWorkerId: string | null;
  attempt: number;
  maxAttempts: number;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Worker {
  id: string;
  name: string;
  status: 'online' | 'offline';
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

export interface MetricsSnapshot {
  ts: string;
  byStatus: Record<string, number>;
  workers: { online: number; offline: number };
  completedTotal: number;
  failedTotal: number;
  retriedTotal: number;
  recoveredTotal: number;
  dlqSize: number;
  throughputPerMin: number;
  successRatePct: number | null;
}

export interface QueueSnapshot {
  byStatus: Record<string, number>;
  oldestPendingSeconds: number | null;
  running: number;
  runningByWorker: Record<string, number>;
}

export interface Snapshot {
  tasks: Task[];
  workers: Worker[];
  queue: QueueSnapshot;
  metrics: MetricsSnapshot;
  events: TaskEvent[];
}

export type LiveMessage =
  | { type: 'snapshot'; payload: Snapshot }
  | { type: 'task.updated'; payload: { type: string; task: Task; at: string } }
  | { type: 'task.event'; payload: { type: string; event: TaskEvent; at: string } }
  | { type: 'worker.updated'; payload: { type: string; worker: Worker; at: string } }
  | { type: 'metrics'; payload: { type: string; metrics: MetricsSnapshot; at: string } };
