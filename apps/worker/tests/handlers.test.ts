import { describe, it, expect } from 'vitest';
import { handlers, UnknownTaskTypeError } from '../src/handlers.js';

describe('demo handlers', () => {
  it('demo.echo returns the payload', async () => {
    const out = await handlers['demo.echo']!({ foo: 'bar' }, 1);
    expect(out).toEqual({ echoed: { foo: 'bar' } });
  });

  it('demo.fail_until_attempt fails below the threshold then succeeds', async () => {
    const h = handlers['demo.fail_until_attempt']!;
    await expect(h({ failUntilAttempt: 2 }, 1)).rejects.toThrow(/attempt 1/);
    await expect(h({ failUntilAttempt: 2 }, 2)).rejects.toThrow(/attempt 2/);
    await expect(h({ failUntilAttempt: 2 }, 3)).resolves.toEqual({ ok: true, recoveredOnAttempt: 3 });
  });

  it('demo.always_fail always throws', async () => {
    await expect(handlers['demo.always_fail']!({}, 1)).rejects.toThrow(/unrecoverable/);
    await expect(handlers['demo.always_fail']!({}, 5)).rejects.toThrow(/unrecoverable/);
  });

  it('demo.crash exits on the configured attempt (process.exit mocked)', async () => {
    const originalExit = process.exit;
    let exitCode: number | null = null;
    (process as any).exit = (code?: number) => {
      exitCode = code ?? 0;
      throw new Error('__exit__');
    };
    try {
      await expect(handlers['demo.crash']!({ crashOnAttempt: 1, workMs: 1 }, 1)).rejects.toThrow('__exit__');
      expect(exitCode).toBe(9);
      // below threshold: no exit
      await expect(handlers['demo.crash']!({ crashOnAttempt: 3, workMs: 1 }, 1)).resolves.toEqual({
        ok: true,
        survivedAttempt: 1,
      });
    } finally {
      (process as any).exit = originalExit;
    }
  });

  it('unknown type has no handler (worker surfaces UnknownTaskTypeError)', () => {
    expect(handlers['demo.nope']).toBeUndefined();
    expect(new UnknownTaskTypeError('demo.nope').message).toMatch(/no handler/);
  });
});
