/**
 * The delay report a driver sends by SMS when there is no data signal. SMS usually gets through where
 * mobile data doesn't. The phone composes a short structured text to the gateway number; the gateway
 * posts it to the API, which parses it back.
 *
 *   RL DELAY VEH041 road_blocked 60 | Nuwara Eliya (before OUT104) | DONE K1-035@05:48
 */
import { DELAY_REASONS, type DelayReason } from "./labels";

export interface DelaySms {
  vehicle_id: string;
  reason: DelayReason;
  minutes: number;
  near: string;
  done: { ref: string; at: string }[];
}

export function formatDelaySms(d: DelaySms): string {
  const done = d.done.length ? ` | DONE ${d.done.map((x) => `${x.ref}@${x.at}`).join(",")}` : "";
  return `RL DELAY ${d.vehicle_id} ${d.reason} ${d.minutes} | ${d.near}${done}`;
}

export function parseDelaySms(body: string): DelaySms | null {
  const m = body.trim().match(/^RL DELAY (\S+) (\S+) (\d{1,3}) \| ([^|]+?)(?: \| DONE (.+))?$/);
  if (!m) return null;
  const reason = m[2] as DelayReason;
  if (!DELAY_REASONS.some((r) => r.id === reason)) return null;
  const done = (m[5] ?? "")
    .split(",")
    .filter(Boolean)
    .map((x) => {
      const [ref, at] = x.split("@");
      return { ref, at };
    })
    .filter((x) => x.ref && /^\d\d:\d\d$/.test(x.at));
  return { vehicle_id: m[1], reason, minutes: Number(m[3]), near: m[4].trim(), done };
}
