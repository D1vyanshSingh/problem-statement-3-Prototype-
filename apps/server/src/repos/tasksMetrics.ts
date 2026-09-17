export interface QueueSnapshot {
  byStatus: Record<string, number>;
  oldestPendingSeconds: number | null;
  running: number;
  runningByWorker: Record<string, number>;
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
