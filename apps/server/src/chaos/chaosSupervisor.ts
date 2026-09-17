import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { seedTasksDeterministic } from '../seedBridge.js';
import type { TasksRepo } from '../repos/tasks.js';
import type { WorkersRepo } from '../repos/workers.js';
import type { Pool } from 'pg';
import { config } from '../config.js';
import { logger } from '../util.js';

const log = logger.child({ mod: 'chaos' });

interface ManagedWorker {
  name: string;
  child: ChildProcess;
}

export class ChaosSupervisor {
  private managed = new Map<string, ManagedWorker>();
  private paused = new Set<string>();
  private counter = 0;

  constructor(
    private readonly tasks: TasksRepo,
    private readonly workers: WorkersRepo,
    private readonly pool: Pool,
  ) {}

  get managedNames(): string[] {
    return [...this.managed.keys()];
  }

  get isPausedSet(): ReadonlySet<string> {
    return this.paused;
  }

  async spawnWorker(): Promise<{ name: string; pid: number | null }> {
    this.counter += 1;
    const name = `worker-${this.counter}`;
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join('apps', 'worker', 'src', 'index.ts'),
        '--name',
        name,
        '--capacity',
        '1',
      ],
      {
        cwd: config.repoRoot,
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
        env: {
          ...process.env,
          RELAY_API: `http://127.0.0.1:${config.port}`,
          RELAY_NAME: name,
          RELAY_CAPACITY: '1',
        },
      },
    );
    child.stderr?.on('data', (d: Buffer) => {
      log.warn({ name, stderr: d.toString().slice(0, 500) }, 'worker stderr');
    });
    child.on('exit', () => this.managed.delete(name));
    this.managed.set(name, { name, child });
    log.info({ name, pid: child.pid }, 'chaos worker spawned');
    return { name, pid: child.pid ?? null };
  }

  async killWorker(name: string): Promise<boolean> {
    const m = this.managed.get(name);
    if (!m) return false;
    this.managed.delete(name);
    try {
      m.child.kill('SIGKILL');
    } catch (err) {
      log.warn({ name, err }, 'kill failed');
    }
    return true;
  }

  killAll(): number {
    const names = [...this.managed.keys()];
    for (const n of names) this.killWorker(n);
    return names.length;
  }

  pauseHeartbeats(name: string): boolean {
    if (!this.managed.has(name)) return false;
    this.paused.add(name);
    return true;
  }

  resumeHeartbeats(name: string): boolean {
    return this.paused.delete(name);
  }

  isPaused(name: string): boolean {
    return this.paused.has(name);
  }

  /** Deterministic seeder (plan §D): outcomes baked into payloads via the core planner. */
  async seedTasks(
    count: number,
    seed: number,
    crashCount?: number,
  ): Promise<{ scheduled: number; mix: Record<string, number> }> {
    return seedTasksDeterministic(this.tasks, count, seed, crashCount);
  }

  async reset(): Promise<void> {
    this.killAll();
    await this.pool.query(
      'TRUNCATE task_events, tasks, workers RESTART IDENTITY',
    );
    log.warn('chaos reset: all tasks, workers, events wiped');
  }
}
