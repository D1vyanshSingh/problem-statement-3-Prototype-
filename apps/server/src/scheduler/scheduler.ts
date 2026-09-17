import type { TasksRepo } from '../repos/tasks.js';
import type { EventBus } from '../events/bus.js';
import { logger, nowIso } from '../util.js';

const log = logger.child({ mod: 'scheduler' });

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tasks: TasksRepo,
    private readonly bus: EventBus,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.error({ err }, 'scheduler tick failed'));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    const n = await this.tasks.promoteScheduled(Date.now());
    if (n > 0) log.info({ promoted: n }, 'scheduled tasks promoted to pending');
    return n;
  }
}
