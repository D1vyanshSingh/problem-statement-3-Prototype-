import { pino } from 'pino';
import { config } from './config.js';

export const logger = pino({ level: config.logLevel });

export const nowIso = (): string => new Date().toISOString();

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Fields that must never be echoed into logs / WS payloads. */
const SENSITIVE_KEYS = new Set(['password', 'secret', 'token', 'authorization', 'apiKey']);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '***' : redact(v, depth + 1);
  }
  return out;
}

/** Ring buffer with the newest event last. */
export class RingBuffer<T> {
  private readonly items: T[] = [];
  constructor(private readonly capacity: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  tail(n: number): T[] {
    return this.items.slice(Math.max(0, this.items.length - n));
  }
  get size(): number {
    return this.items.length;
  }
}
