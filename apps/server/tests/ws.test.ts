import { describe, it, expect, beforeAll } from 'vitest';
import WebSocket from 'ws';
import { getTestServer, api } from './helpers.js';
import { config } from '../src/config.js';

beforeAll(async () => {
  await getTestServer();
});

interface WsClient {
  ws: WebSocket;
  messages: any[];
  close(): void;
}

function wsConnect(): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    const messages: any[] = [];
    // buffer from the earliest possible moment so the initial snapshot is never lost
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });
    ws.on('open', () => resolve({ ws, messages, close: () => ws.close() }));
    ws.on('error', reject);
  });
}

async function waitFor(client: WsClient, pred: (m: any) => boolean, timeoutMs = 8000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  while (Date.now() < deadline) {
    if (seen < client.messages.length) {
      const m = client.messages[seen++]!;
      if (pred(m)) return m;
      continue;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('ws condition not met within timeout');
}

describe('websocket hub', () => {
  it('sends a snapshot on connect and live task updates', async () => {
    const client = await wsConnect();

    const snap = await waitFor(client, (m) => m.type === 'snapshot');
    expect(Array.isArray(snap.payload.tasks)).toBe(true);
    expect(Array.isArray(snap.payload.workers)).toBe(true);

    // create + claim + complete a task; expect at least one task.updated delta
    const created = await api<{ id: string }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ type: 'demo.echo' }),
    });
    const reg = await api<{ id: string }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify({ name: `ws-worker-${Date.now()}`, capacity: 1 }),
    });
    const claimed = await api<{ tasks: Array<{ id: string; leaseToken: string }> }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId: reg.body.id, batch: 5 }),
    });
    const t = claimed.body.tasks.find((x) => x.id === created.body.id)!;
    await api(`/api/tasks/${t.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ workerId: reg.body.id, leaseToken: t.leaseToken }),
    });

    const update = await waitFor(client, (m) => m.type === 'task.updated');
    expect(update.payload.task.id).toBe(t.id);
    client.close();
  }, 25_000);
});
