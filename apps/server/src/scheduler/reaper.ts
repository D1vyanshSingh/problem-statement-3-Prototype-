import type { TasksRepo } from '../repos/tasks.js';
import type { WorkersRepo } from '../repos/workers.js';
import type { EventBus } from '../events/bus.js';
import { logger, nowIso } from '../util.js';

const log = logger.child({ mod: 'reaper' });

export class Reaper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tasks: TasksRepo,
    private readonly workers: WorkersRepo,
    private readonly bus: EventBus,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.error({ err }, 'reaper tick failed'));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ timedOutWorkers: number; recoveredTasks: number }> {
    const timedOut = await this.workers.markTimedOut();
    const recovered = await this.tasks.recoverExpired();
    if (timedOut.length > 0) {
      log.warn(
        { workers: timedOut.map((w) => w.name) },
        'workers marked offline (heartbeat timeout)',
      );
    }
    if (recovered.length > 0) {
      log.warn({ tasks: recovered.length }, 'expired leases recovered to pending');
    }
    return { timedOutWorkers: timedOut.length, recoveredTasks: recovered.length };
  }
}
