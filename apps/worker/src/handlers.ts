import { logger } from './util.js';

const log = logger.child({ mod: 'handlers' });

export type TaskHandler = (
  payload: Record<string, unknown>,
  attempt: number,
) => Promise<Record<string, unknown> | void>;

export class UnknownTaskTypeError extends Error {
  constructor(type: string) {
    super(`no handler for task type ${type}`);
  }
}

const ms = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

export const handlers: Record<string, TaskHandler> = {
  'demo.echo': async (payload) => ({ echoed: payload }),

  'demo.sleep': async (payload) => {
    await new Promise((r) => setTimeout(r, ms(payload.workMs, 1000)));
    return { sleptMs: ms(payload.workMs, 1000) };
  },

  'demo.fail_until_attempt': async (payload, attempt) => {
    const failUntil = ms(payload.failUntilAttempt, 1);
    if (attempt <= failUntil) {
      throw new Error(`simulated failure: attempt ${attempt} <= failUntilAttempt ${failUntil}`);
    }
    return { ok: true, recoveredOnAttempt: attempt };
  },

  'demo.always_fail': async (payload) => {
    throw new Error(`unrecoverable failure for seed item ${String(payload.i ?? '?')}`);
  },

  'demo.crash': async (payload, attempt) => {
    const crashOn = ms(payload.crashOnAttempt, 1);
    // Crash EXACTLY once (attempt === crashOn): the first execution kills the
    // worker mid-task; every later attempt (after recovery/reassignment)
    // succeeds — completing the failure→recovery→success story.
    if (attempt === crashOn) {
      const workMs = ms(payload.workMs, 500);
      await new Promise((r) => setTimeout(r, workMs));
      log.warn({ crashOn, workMs }, 'demo.crash: hard-exiting process mid-task');
      process.exit(9);
    }
    return { ok: true, survivedAttempt: attempt };
  },
};
