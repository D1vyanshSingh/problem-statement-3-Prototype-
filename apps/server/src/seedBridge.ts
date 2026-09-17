import { planSeedMix, seedMixSummary, type SeedPlanItem } from '@relay/core';
import type { TasksRepo } from './repos/tasks.js';

/**
 * Deterministic seeder (plan §D). `crashCount` caps the number of demo.crash
 * tasks (extras are deterministically replaced with demo.echo) so the guided
 * demo kills exactly one worker instead of cascading through the fleet.
 */
export async function seedTasksDeterministic(
  tasks: TasksRepo,
  count: number,
  seed: number,
  crashCount?: number,
): Promise<{ scheduled: number; mix: Record<string, number> }> {
  const items: SeedPlanItem[] = planSeedMix(count, seed);
  if (crashCount !== undefined) {
    let crashes = 0;
    items.forEach((it) => {
      if (it.type === 'demo.crash') {
        crashes += 1;
        if (crashes > crashCount) {
          it.type = 'demo.echo';
          it.payload = { i: it.index, msg: `seed-${seed}-${it.index}`, replacedFrom: 'demo.crash' };
        }
      }
    });
  }
  for (const item of items) {
    await tasks.create({ type: item.type, payload: item.payload, maxAttempts: 3 });
  }
  const mix = seedMixSummary(items);
  return { scheduled: count, mix: { ...mix } };
}
