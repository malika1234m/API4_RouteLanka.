/**
 * Road conditions on the demo day (Fri 24 April 2026, monsoon) from road_conditions.csv.
 * 100 is a normal day; lower means disrupted (landslides, flooding, closures).
 */
export const ROAD_TODAY: Record<string, number> = {
  Colombo: 71, Gampaha: 91, Kalutara: 99, Galle: 99, Matara: 100, Kurunegala: 98,
  Puttalam: 100, Kandy: 66, Matale: 100, "Nuwara Eliya": 86, Badulla: 100, Kegalle: 50,
};

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

/** Districts disrupted today, worst first. */
export const DISRUPTED = Object.entries(ROAD_TODAY)
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
