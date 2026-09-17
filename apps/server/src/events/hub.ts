import type { WebSocket } from 'ws';
import type { EventBus, LiveSnapshot } from './bus.js';

export class WsHub {
  private clients = new Set<WebSocket>();

  constructor(
    private readonly bus: EventBus,
    private readonly getSnapshot: () => LiveSnapshot,
  ) {}

  attach(ws: WebSocket): void {
    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', payload: this.getSnapshot() }));
    const unsub = this.bus.subscribe((e) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: e.type, payload: e }));
    });
    ws.on('close', () => {
      unsub();
      this.clients.delete(ws);
    });
    ws.on('error', () => {
      unsub();
      this.clients.delete(ws);
    });
  }

  get count(): number {
    return this.clients.size;
  }
}
