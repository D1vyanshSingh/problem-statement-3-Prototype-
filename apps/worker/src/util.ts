import { pino } from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
