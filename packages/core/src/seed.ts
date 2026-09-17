export interface SeedPlanItem {
  index: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface SeedMix {
  'demo.echo': number;
  'demo.fail_until_attempt': number;
  'demo.always_fail': number;
  'demo.crash': number;
}

export const DEMO_TYPES = [
  'demo.echo',
  'demo.fail_until_attempt',
  'demo.always_fail',
  'demo.crash',
] as const;

export function planSeedMix(count: number, seed: number): SeedPlanItem[] {
  const rand = mulberry32(hashSeed(seed));
  const items: SeedPlanItem[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    if (r < 0.6) {
      items.push({ index: i, type: 'demo.echo', payload: { i, msg: `seed-${seed}-${i}` } });
    } else if (r < 0.8) {
      items.push({
        index: i,
        type: 'demo.fail_until_attempt',
        payload: { failUntilAttempt: r < 0.7 ? 1 : 2, workMs: 100 + Math.floor(rand() * 200) },
      });
    } else if (r < 0.9) {
      items.push({ index: i, type: 'demo.always_fail', payload: { i } });
    } else {
      items.push({ index: i, type: 'demo.crash', payload: { crashOnAttempt: 1, workMs: 800 } });
    }
  }
  return items;
}

export function seedMixSummary(items: SeedPlanItem[]): SeedMix {
  const mix: SeedMix = {
    'demo.echo': 0,
    'demo.fail_until_attempt': 0,
    'demo.always_fail': 0,
    'demo.crash': 0,
  };
  for (const it of items) if (it.type in mix) mix[it.type as keyof SeedMix] += 1;
  return mix;
}

function hashSeed(seed: number): number {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
