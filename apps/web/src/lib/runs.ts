import type { DriverView } from "@routelanka/domain";
import type { DemoState } from "./store";

/** Runs with a driver's phone on them, by trip key ("VEH041#1"). Other runs are only known from the plan. */
export const runKey = (r: Pick<DriverView, "vehicle_id" | "trip_id">) => `${r.vehicle_id}#${r.trip_id}`;

/** The phone on this run, if it has one. The run open on this phone includes its unsent records. */
export function runFor(s: DemoState, k: string): DriverView | undefined {
  if (runKey(s.driver) === k) return s.driver;
  return s.drivers.find((r) => runKey(r) === k);
}

/** Runs whose phone has no signal. */
export const offlineRuns = (s: DemoState) => s.drivers.map((r) => runFor(s, runKey(r))!).filter((r) => !r.online);
