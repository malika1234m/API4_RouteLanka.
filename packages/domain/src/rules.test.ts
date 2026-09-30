import { describe, expect, it } from "vitest";
import { checkMove, planViolations, tripMinutes, type RuleRef } from "./rules";
import { clockStartFor, clockTime, fromMin, toMin } from "./time";
import { codeHash, codeMatches } from "./handover";
import { formatDelaySms, parseDelaySms } from "./sms";
import type { District, Order, Vehicle } from "./types";

// The booklet's worked examples (Task 2B, "Calculate trip time").
const districts: Record<string, District> = {
  Gampaha: { district: "Gampaha", depot: "Peliyagoda", road_class: "suburban", depot_to_district_km: 28, depot_to_district_freeflow_min: 37, inter_stop_km: 7, inter_stop_freeflow_min: 9 },
  Colombo: { district: "Colombo", depot: "Peliyagoda", road_class: "urban", depot_to_district_km: 12, depot_to_district_freeflow_min: 24, inter_stop_km: 4, inter_stop_freeflow_min: 8 },
};
const allowance: Record<string, number> = { "Fresh|rear_dock": 15, "Fresh|street": 16, "Fresh|mall_bay": 20 };

const truck: Vehicle = { vehicle_id: "T1", type: "truck", temp: "ambient", weight_cap_kg: 5000, volume_cap_m3: 20, km_per_l: 5, weekly_fuel_quota_l: 400, fuel_used_l: 100, depot: "Peliyagoda", status: "available" };
const reefer: Vehicle = { ...truck, vehicle_id: "R1", temp: "reefer" };
const van: Vehicle = { ...truck, vehicle_id: "V1", type: "van", volume_cap_m3: 8 };
const vehicles = [truck, reefer, van];

const ref: RuleRef = {
  district: (n) => districts[n],
  allowance: (b, d) => allowance[`${b}|${d}`] ?? 15,
  vehicle: (id) => vehicles.find((v) => v.vehicle_id === id),
};

let n = 0;
const order = (o: Partial<Order> = {}): Order => ({
  order_ref: `O${++n}`,
  outlet_id: `OUT${n}`,
  brand: "Fresh",
  district: "Gampaha",
  depot: "Peliyagoda",
  dock_type: "rear_dock",
  parking_constraint: "normal",
  mall_window: "",
  window_open_time: "05:00",
  window_close_time: "08:00",
  temp_requirement: "ambient",
  order_units: 10,
  order_weight_kg: 100,
  order_volume_m3: 1,
  deferred_yesterday: 0,
  days_since_last_served: 1,
  decision: "deferred",
  priority: 0,
  ...o,
});

describe("trip time (booklet examples)", () => {
  it("Fresh trip to Gampaha, two rear docks and one street stop = 101 min", () => {
    expect(tripMinutes(ref, "Gampaha", "Fresh", ["rear_dock", "rear_dock", "street"])).toBe(101);
  });
  it("second Fresh trip to Colombo, four street stops = 112 min", () => {
    expect(tripMinutes(ref, "Colombo", "Fresh", ["street", "street", "street", "street"])).toBe(112);
  });
  it("a trip with no stops takes no time", () => {
    expect(tripMinutes(ref, "Colombo", "Fresh", [])).toBe(0);
  });
});

describe("operating rules", () => {
  it("chilled goods need a refrigerated vehicle", () => {
    const o = order({ temp_requirement: "chilled" });
    expect(checkMove(ref, [o], o.order_ref, "T1", 1)).toContain("Trip 1: chilled goods need a refrigerated vehicle");
    expect(checkMove(ref, [o], o.order_ref, "R1", 1)).toEqual([]);
  });

  it("van-only outlets can't take a truck", () => {
    const o = order({ parking_constraint: "van_only" });
    expect(checkMove(ref, [o], o.order_ref, "T1", 1)).toContain("Trip 1: a van-only outlet cannot take a truck");
    expect(checkMove(ref, [o], o.order_ref, "V1", 1)).toEqual([]);
  });

  it("one brand and one district per trip", () => {
    const a = order({ decision: "served", vehicle_id: "T1", trip_id: 1 });
    const b = order({ district: "Colombo" });
    expect(checkMove(ref, [a, b], b.order_ref, "T1", 1)).toContain("Trip 1 mixes districts (one district per trip)");
    expect(checkMove(ref, [a, b], b.order_ref, "T1", 2)).toEqual([]);
  });

  it("weight and volume must both fit", () => {
    const big = order({ order_volume_m3: 21 });
    expect(checkMove(ref, [big], big.order_ref, "T1", 1)[0]).toMatch(/exceeds 20 m³/);
    const heavy = order({ order_weight_kg: 6000 });
    expect(checkMove(ref, [heavy], heavy.order_ref, "T1", 1)[0]).toMatch(/exceeds 5000 kg/);
  });

  it("at most two trips, and only trip 1 or 2", () => {
    const o = order();
    expect(checkMove(ref, [o], o.order_ref, "T1", 3)).toEqual(["A vehicle runs trip 1 or trip 2 only"]);
  });

  it("the Fresh window is 270 minutes across a vehicle's Fresh trips", () => {
    // Two Gampaha trips of 5 stops each: 37 + 4*9 + 5*15 = 148 min each, 296 in total.
    const first = Array.from({ length: 5 }, () => order({ decision: "served", vehicle_id: "T1", trip_id: 1 }));
    const second = Array.from({ length: 4 }, () => order({ decision: "served", vehicle_id: "T1", trip_id: 2 }));
    const last = order();
    expect(checkMove(ref, [...first, ...second, last], last.order_ref, "T1", 2).some((v) => v.startsWith("Fresh trips take 296 min"))).toBe(true);
  });

  it("a vehicle in the workshop can't be used", () => {
    const o = order({ decision: "served", vehicle_id: "T1", trip_id: 1 });
    expect(planViolations(ref, [{ ...truck, status: "in_workshop" }], [o])).toEqual(["T1: T1 is in the workshop"]);
  });
});

describe("demo clock", () => {
  it("reads 03:00 at the start and runs at the given speed", () => {
    expect(clockTime(0, 15, 0)).toBe("03:00");
    expect(clockTime(0, 15, 4 * 60000)).toBe("04:00");
  });
  it("can be moved forward to a planned time", () => {
    const now = 1_000_000;
    expect(clockTime(clockStartFor("05:48", 15, now), 15, now)).toBe("05:48");
  });
  it("converts times", () => {
    expect(toMin("07:45")).toBe(465);
    expect(fromMin(465)).toBe("07:45");
  });
});

describe("handover codes", () => {
  it("the phone checks a code against its hash without knowing the code", () => {
    const h = codeHash("K1-035", "2372");
    expect(codeMatches("K1-035", "2372", h)).toBe(true);
    expect(codeMatches("K1-035", "1111", h)).toBe(false);
    expect(codeMatches("K1-036", "2372", h)).toBe(false); // bound to the order
    expect(codeMatches("K1-035", "2372", undefined)).toBe(false);
  });
});

describe("SMS delay report", () => {
  it("round-trips through the text format", () => {
    const d = { vehicle_id: "VEH041", reason: "road_blocked" as const, minutes: 60, near: "Nuwara Eliya (before OUT104)", done: [{ ref: "K1-035", at: "05:48" }] };
    expect(parseDelaySms(formatDelaySms(d))).toEqual(d);
  });
  it("rejects other texts and unknown reasons", () => {
    expect(parseDelaySms("hello")).toBeNull();
    expect(parseDelaySms("RL DELAY VEH041 aliens 60 | Kandy")).toBeNull();
  });
});
