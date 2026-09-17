import { VitalsApi } from './api.js';
import { handlers, UnknownTaskTypeError } from './handlers.js';
import { logger, sleep } from './util.js';
import {
  HEARTBEAT_INTERVAL_MS,
  CLAIM_POLL_MS,
  WORKER_NAME,
  WORKER_CAPACITY,
} from './config.js';

const log = logger.child({ mod: 'worker' });

export class WorkerNode {
  private api = new VitalsApi();
  private running = false;
  private executing = 0;
  private paused = false;
  private aborts = new Map<string, AbortController>();
  private loops: Promise<void>[] = [];

  constructor(
    private readonly heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    private readonly claimPollMs = CLAIM_POLL_MS,
  ) {}

  get name(): string {
    return WORKER_NAME;
  }

  get busyCount(): number {
    return this.executing;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.api.register();
    this.loops = [this.heartbeatLoop(), this.claimLoop()];
    log.info({ name: this.name }, 'worker started');
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.api.shutdown();
    const deadline = Date.now() + 5000;
    while (this.executing > 0 && Date.now() < deadline) {
      await sleep(100);
    }
    for (const [, ac] of this.aborts) ac.abort();
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.running) {
      try {
        const res = await this.api.heartbeat();
        if (res === null) {
          log.warn('heartbeat rejected - re-registering');
          await this.api.register();
        } else {
          this.paused = res.paused;
          for (const taskId of res.revoked ?? []) {
            log.warn({ taskId }, 'lease revoked - aborting execution');
            this.aborts.get(taskId)?.abort();
            this.api.dropLease(taskId);
          }
        }
      } catch (err) {
        log.warn({ err }, 'heartbeat error');
      }
      await sleep(this.heartbeatIntervalMs);
    }
  }

  private async claimLoop(): Promise<void> {
    while (this.running) {
      try {
        if (this.paused) {
          await sleep(200);
          continue;
        }
        const batch = Math.max(0, WORKER_CAPACITY - this.executing);
        if (batch === 0) {
          await sleep(this.claimPollMs);
          continue;
        }
        const tasks = await this.api.claim(batch);
        for (const t of tasks) {
          this.execute(t).catch((err) => log.error({ err, taskId: t.id }, 'execute crashed'));
        }
      } catch (err) {
        log.warn({ err }, 'claim error');
      }
      await sleep(this.claimPollMs);
    }
  }

  private async execute(t: { id: string; type: string; payload: Record<string, unknown>; attempt: number }): Promise<void> {
    const ac = new AbortController();
    this.aborts.set(t.id, ac);
    this.executing += 1;
    const startedAt = Date.now();
    try {
      const handler = handlers[t.type];
      if (!handler) throw new UnknownTaskTypeError(t.type);
      log.info({ taskId: t.id, type: t.type, attempt: t.attempt }, 'executing task');
      const result = await handler(t.payload, t.attempt);
      if (ac.signal.aborted) {
        log.warn({ taskId: t.id }, 'task aborted - not acking');
        return;
      }
      const ok = await this.api.complete(t.id, (result as Record<string, unknown>) ?? {});
      if (!ok) log.warn({ taskId: t.id }, 'complete rejected (fence) - result discarded');
      else log.info({ taskId: t.id, ms: Date.now() - startedAt }, 'task completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (ac.signal.aborted) {
        log.warn({ taskId: t.id }, 'task aborted after error - not acking failure');
        return;
      }
      const ok = await this.api.fail(t.id, msg.slice(0, 500));
      if (!ok) log.warn({ taskId: t.id }, 'fail rejected (fence)');
      else log.info({ taskId: t.id, attempt: t.attempt, error: msg.slice(0, 120) }, 'task failed');
    } finally {
      this.executing -= 1;
      this.aborts.delete(t.id);
    }
  }
}
