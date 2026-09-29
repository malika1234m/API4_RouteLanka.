/**
 * Clock times on a delivery day. A demo day runs on a clock that reads 03:00 at its start and moves
 * `speed` times faster than real time, so a whole night fits in a walkthrough. Both the API and the
 * phone use the same function, so a record made offline carries the same time the server would give it.
 */
export const DAY_START_MIN = 3 * 60;

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const fromMin = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m) % 60).padStart(2, "0")}`;

/** Demo-clock minutes since midnight at real time `nowMs`. */
export function clockMinutes(clockStartMs: number, speed: number, nowMs = Date.now()): number {
  return DAY_START_MIN + Math.floor(((nowMs - clockStartMs) / 60000) * speed);
}

export function clockTime(clockStartMs: number, speed: number, nowMs = Date.now()): string {
  return fromMin(clockMinutes(clockStartMs, speed, nowMs));
}

/**
 * The clock start that makes the demo clock read `hhmm` right now. Used to skip a drive: the clock
 * only ever moves forward, never back.
 */
export function clockStartFor(hhmm: string, speed: number, nowMs = Date.now()): number {
  return nowMs - ((toMin(hhmm) - DAY_START_MIN) / speed) * 60000;
}
