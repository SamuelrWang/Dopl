/** An injectable clock, so every hold and expiry is testable without real time. */
export interface Clock {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const nowOf = (c: Clock): number => (c.now ?? Date.now)();
export const sleepOf = (c: Clock) => c.sleep ?? realSleep;
export const iso = (ms: number): string => new Date(ms).toISOString();
