// Simple CLI flags: --name X --capacity N (override env)
const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export const VITALS_API = process.env.VITALS_API ?? 'http://127.0.0.1:8080';
export const WORKER_NAME = flag('--name') ?? process.env.VITALS_NAME ?? `worker-${process.pid}`;
export const WORKER_CAPACITY = num(flag('--capacity') ?? process.env.VITALS_CAPACITY, 4);
export const HEARTBEAT_INTERVAL_MS = num(process.env.HEARTBEAT_INTERVAL_MS, 1500);
export const HEARTBEAT_TIMEOUT_MS = num(process.env.HEARTBEAT_TIMEOUT_MS, 5000);
export const LEASE_TIMEOUT_MS = num(process.env.LEASE_TIMEOUT_MS, 7000);
export const CLAIM_POLL_MS = num(process.env.CLAIM_POLL_MS, 400);
