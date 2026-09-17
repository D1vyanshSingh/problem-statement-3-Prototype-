import { describe, it, expect, beforeAll } from 'vitest';
import { getTestServer, api, resetTasks } from './helpers.js';

interface Task {
  id: string;
  status: string;
  attempt: number;
  leaseToken: string | null;
}

beforeAll(async () => {
  await getTestServer();
  await resetTasks();
});

describe('atomic claims', () => {
  it('a task is leased to exactly one worker under concurrency', async () => {
    // seed 5 tasks at high priority so they sort ahead of any leftovers
    // from earlier test files sharing this server/database
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await api<Task>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ type: 'demo.echo', payload: { i }, priority: 100000 }),
      });
      ids.push(r.body.id);
    }

    // register 4 workers, all claim concurrently
    const workers: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await api<{ id: string }>('/api/workers', {
        method: 'POST',
        body: JSON.stringify({ name: `race-worker-${Date.now()}-${i}`, capacity: 5 }),
      });
      workers.push(r.body.id);
    }
    const results = await Promise.all(
      workers.map((wid) =>
        api<{ tasks: Task[] }>('/api/tasks/claim', {
          method: 'POST',
          body: JSON.stringify({ workerId: wid, batch: 5 }),
        }),
      ),
    );

    // collect all claimed task ids
    const claimed = results.flatMap((r) => r.body.tasks);
    const claimedIds = claimed.map((t) => t.id);

    // no duplicates
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    // all 5 seeded tasks were claimed exactly once
    for (const id of ids) expect(claimedIds).toContain(id);
    expect(claimedIds.filter((id) => ids.includes(id)).length).toBe(5);

    // every claim is running with a lease token
    for (const t of claimed) {
      if (ids.includes(t.id)) {
        expect(t.status).toBe('running');
        expect(t.leaseToken).toBeTruthy();
      }
    }
  });
});
