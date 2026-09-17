import {
  VITALS_API,
  WORKER_NAME,
  WORKER_CAPACITY,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  LEASE_TIMEOUT_MS,
  CLAIM_POLL_MS,
} from './config.js';
import { sleep } from './util.js';
import { logger } from './util.js';

const log = logger.child({ mod: 'api' });

export interface TaskView {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  leaseToken?: string | null;
  assignedWorkerId?: string | null;
}

export interface Lease {
  taskId: string;
  leaseToken: string;
}

export class VitalsApi {
  private base = VITALS_API;
  private workerId: string | null = null;
  private leases = new Map<string, string>();

  get id(): string | null {
    return this.workerId;
  }

  setLease(taskId: string, token: string): void {
    this.leases.set(taskId, token);
  }

  dropLease(taskId: string): void {
    this.leases.delete(taskId);
  }

  currentLeases(): Lease[] {
    return [...this.leases.entries()].map(([taskId, leaseToken]) => ({ taskId, leaseToken }));
  }

  async register(): Promise<void> {
    const res = await this.fetchWithRetry('/api/workers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: WORKER_NAME,
        capacity: WORKER_CAPACITY,
        metadata: {
          hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown',
          pid: process.pid,
          startedAt: new Date().toISOString(),
          version: '1.0.0',
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`register failed: ${res.status} ${await res.text()}`);
    }
    const w = (await res.json()) as { id: string };
    this.workerId = w.id;
    log.info({ workerId: w.id }, 'registered');
  }

  private async fetchWithRetry(path: string, init: RequestInit, tries = 5): Promise<Response> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        return await fetch(`${this.base}${path}`, init);
      } catch (err) {
        lastErr = err;
        await sleep(300 * (i + 1));
      }
    }
    throw new Error(`fetch failed after ${tries} tries: ${String(lastErr)}`);
  }

  async heartbeat(): Promise<{ paused: boolean; revoked: string[] } | null> {
    if (!this.workerId) return null;
    try {
      const res = await this.fetchWithRetry(
        `/api/workers/${this.workerId}/heartbeat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leases: this.currentLeases() }),
        },
        2,
      );
      if (res.status === 409) return null; // must re-register
      if (!res.ok) return null;
      return (await res.json()) as { paused: boolean; revoked: string[] };
    } catch {
      return null;
    }
  }

  async claim(batch: number): Promise<TaskView[]> {
    if (!this.workerId) return [];
    try {
      const res = await this.fetchWithRetry(
        '/api/tasks/claim',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workerId: this.workerId, batch }),
        },
        2,
      );
      if (!res.ok) return [];
      const j = (await res.json()) as { tasks: TaskView[] };
      for (const t of j.tasks) {
        if (t.leaseToken) this.setLease(t.id, t.leaseToken);
      }
      return j.tasks;
    } catch {
      return [];
    }
  }

  async complete(taskId: string, result?: Record<string, unknown>): Promise<boolean> {
    const leaseToken = this.leases.get(taskId);
    if (!leaseToken) return false;
    try {
      const res = await this.fetchWithRetry(
        `/api/tasks/${taskId}/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workerId: this.workerId, leaseToken, result }),
        },
        3,
      );
      this.dropLease(taskId);
      return res.ok;
    } catch {
      this.dropLease(taskId);
      return false;
    }
  }

  async fail(taskId: string, error: string): Promise<boolean> {
    const leaseToken = this.leases.get(taskId);
    if (!leaseToken) return false;
    try {
      const res = await this.fetchWithRetry(
        `/api/tasks/${taskId}/fail`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workerId: this.workerId, leaseToken, error }),
        },
        3,
      );
      this.dropLease(taskId);
      return res.ok;
    } catch {
      this.dropLease(taskId);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.workerId) return;
    try {
      await this.fetchWithRetry(
        `/api/workers/${this.workerId}/shutdown`,
        { method: 'POST' },
        2,
      );
    } catch {
      /* best-effort */
    }
  }
}

export { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, LEASE_TIMEOUT_MS, CLAIM_POLL_MS };
