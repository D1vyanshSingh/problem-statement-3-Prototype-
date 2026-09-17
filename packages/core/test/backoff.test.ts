import { describe, it, expect } from 'vitest';
import { backoffMs } from '../src/backoff.js';
import { planSeedMix, seedMixSummary } from '../src/seed.js';

describe('backoff', () => {
  it('doubles per attempt and respects the cap', () => {
    expect(backoffMs(1, 1000, 30_000)).toBe(1000);
    expect(backoffMs(2, 1000, 30_000)).toBe(2000);
    expect(backoffMs(3, 1000, 30_000)).toBe(4000);
    expect(backoffMs(10, 1000, 30_000)).toBe(30_000);
  });
});

describe('seed planner', () => {
  it('is deterministic for the same seed', () => {
    const a = planSeedMix(24, 42);
    const b = planSeedMix(24, 42);
    expect(a).toEqual(b);
    const mix = seedMixSummary(a);
    expect(mix['demo.echo']).toBeGreaterThan(0);
    expect(mix['demo.crash']).toBeGreaterThan(0);
    expect(mix['demo.always_fail']).toBeGreaterThan(0);
  });

  it('differs across seeds', () => {
    const a = seedMixSummary(planSeedMix(24, 42));
    const b = seedMixSummary(planSeedMix(24, 43));
    expect(a).not.toEqual(b);
  });
});
