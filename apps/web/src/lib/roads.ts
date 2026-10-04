import { seed } from "./seed";

/**
 * Road conditions on the night being run, from road_conditions.csv (sent by the API with the reference data).
 * 100 is a normal day; lower means disrupted (landslides, flooding, closures). A district with no record is normal.
 */
export const roadToday = (district: string): number => seed.road_today[district] ?? 100;

/**
 * Average minutes a leg ran over plan at each level of the index, measured on 91,894 legs
 * of route history (index 90+: 11, 70–89: 19, 50–69: 43, below 50: 65).
 */
export function extraMinutes(index: number): number {
  if (index < 50) return 65;
  if (index < 70) return 43;
  if (index < 90) return 19;
  return 11;
}

/** Districts disrupted tonight, worst first. */
export const disrupted = (): [string, number][] =>
  Object.entries(seed.road_today)
    .filter(([, v]) => v < 75)
    .sort((a, b) => a[1] - b[1]);

/** A run from a depot passes through the depot's own district first. */
export const DEPOT_DISTRICT: Record<string, string> = { Kandy: "Kandy", Peliyagoda: "Colombo" };

export const DELAY_REASONS = [
  { id: "road_blocked", label: "Road blocked" },
  { id: "slow_traffic", label: "Very slow traffic" },
  { id: "weather", label: "Heavy rain or flooding" },
  { id: "vehicle", label: "Vehicle problem" },
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number]["id"];
