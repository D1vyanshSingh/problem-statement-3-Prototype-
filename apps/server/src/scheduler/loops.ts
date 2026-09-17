import type { MetricsRepo } from '../repos/metrics.js';
import type { EventBus } from '../events/bus.js';
import { logger, nowIso } from '../util.js';

const log = logger.child({ mod: 'loops' });

export function startMetricsLoop(
  metrics: MetricsRepo,
  bus: EventBus,
  intervalMs: number,
): () => void {
  const timer = setInterval(() => {
    metrics
      .metrics()
      .then((m) => bus.emit({ type: 'metrics', metrics: m, at: nowIso() }))
      .catch((err) => log.warn({ err }, 'metrics tick failed'));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
