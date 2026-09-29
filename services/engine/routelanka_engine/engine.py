"""Allocation engine (prototype): priority-greedy with hard-constraint validation.

Rules enforced (booklet, Task 2B feasibility):
  one brand + one district per trip, chilled -> reefer, van_only -> van,
  home depot, whole orders, weight + volume per trip, <= 2 trips per vehicle,
  Fresh trips <= 270 min, Style/Tech trips <= 480 min, weekly fuel quota.
Every deferred order gets a reason code naming the limit that stopped it.
"""
from dataclasses import dataclass, field

FRESH_BUDGET, DAY_BUDGET, MAX_TRIPS = 270, 480, 2

BRAND_WEIGHT = {("Fresh", "chilled"): 50, ("Fresh", "ambient"): 40, ("Tech", "ambient"): 30, ("Style", "ambient"): 25}


def priority(o):
    """Higher = served first. Repeat-skipped outlets jump the queue."""
    return (BRAND_WEIGHT[(o["brand"], o["temp_requirement"])]
            + 100 * o.get("deferred_yesterday", 0)
            + 8 * min(o.get("days_since_last_served", 1), 7))


def trip_minutes(trip, dtravel, allowance):
    d = dtravel[trip["district"]]
    n = len(trip["orders"])
    return (d["depot_to_district_freeflow_min"] + (n - 1) * d["inter_stop_freeflow_min"]
            + sum(allowance[(trip["brand"], o["dock_type"])] for o in trip["orders"]))


def trip_km(trip, dtravel):
    d = dtravel[trip["district"]]
    return 2 * d["depot_to_district_km"] + (len(trip["orders"]) - 1) * d["inter_stop_km"]


@dataclass
class VState:
    v: dict
    fuel_left_l: float
    trips: list = field(default_factory=list)

    def minutes(self, fresh, dtravel, allowance):
        return sum(trip_minutes(t, dtravel, allowance) for t in self.trips if (t["brand"] == "Fresh") == fresh)

    def fuel_used(self, dtravel):
        return sum(trip_km(t, dtravel) / self.v["km_per_l"] for t in self.trips)


def compatible(v, o):
    if o["temp_requirement"] == "chilled" and v["temp"] != "reefer":
        return False
    if o["parking_constraint"] == "van_only" and v["type"] != "van":
        return False
    return v["depot"] == o["depot"]


def fits(vs, trip, o, dtravel, allowance):
    """Would adding order o to trip (existing or new) keep vehicle vs feasible?"""
    v = vs.v
    new = dict(trip, orders=trip["orders"] + [o])
    if sum(x["order_volume_m3"] for x in new["orders"]) > v["volume_cap_m3"] + 1e-9:
        return "capacity"
    if sum(x["order_weight_kg"] for x in new["orders"]) > v["weight_cap_kg"] + 1e-9:
        return "capacity"
    fresh = new["brand"] == "Fresh"
    others = [t for t in vs.trips if t is not trip and (t["brand"] == "Fresh") == fresh]
    mins = sum(trip_minutes(t, dtravel, allowance) for t in others) + trip_minutes(new, dtravel, allowance)
    if mins > (FRESH_BUDGET if fresh else DAY_BUDGET) + 1e-9:
        return "time"
    other_fuel = sum(trip_km(t, dtravel) for t in vs.trips if t is not trip) / v["km_per_l"]
    if other_fuel + trip_km(new, dtravel) / v["km_per_l"] > vs.fuel_left_l + 1e-9:
        return "fuel"
    return None


def scarcity(v):
    """Prefer the least special vehicle that works, to keep reefers and vans free."""
    return (v["temp"] == "reefer") * 2 + (v["type"] == "van") * 1


def allocate(orders, vehicles, available, dtravel, allowance, fuel_left):
    states = {v["vehicle_id"]: VState(v, fuel_left[v["vehicle_id"]]) for v in vehicles if v["vehicle_id"] in available}
    result = {}
    # Orders that only one or two vehicles can carry go first, so scarce vehicles
    # (the reefer van) are not used up by orders any truck could take.
    n_compat = {o["order_ref"]: sum(compatible(s.v, o) for s in states.values()) for o in orders}
    for o in sorted(orders, key=lambda o: (n_compat[o["order_ref"]] > 2, -priority(o), -o["order_volume_m3"])):
        cands = [s for s in states.values() if compatible(s.v, o)]
        if not cands:
            result[o["order_ref"]] = {"decision": "deferred", "reason": _no_vehicle_reason(o)}
            continue
        placed, blockers = False, set()
        # 1) join an existing trip for the same brand + district
        for s in sorted(cands, key=lambda s: scarcity(s.v)):
            for t in s.trips:
                if t["brand"] == o["brand"] and t["district"] == o["district"]:
                    why = fits(s, t, o, dtravel, allowance)
                    if why is None:
                        t["orders"].append(o)
                        result[o["order_ref"]] = {"decision": "served", "vehicle_id": s.v["vehicle_id"], "trip_id": t["trip_id"]}
                        placed = True
                        break
                    blockers.add(why)
            if placed:
                break
        if placed:
            continue
        # 2) open a new trip on the least special vehicle that can take it
        for s in sorted(cands, key=lambda s: (scarcity(s.v), len(s.trips), -s.v["volume_cap_m3"])):
            if len(s.trips) >= MAX_TRIPS:
                blockers.add("trips")
                continue
            t = {"trip_id": len(s.trips) + 1, "brand": o["brand"], "district": o["district"], "orders": []}
            why = fits(s, t, o, dtravel, allowance)
            if why is None:
                t["orders"].append(o)
                s.trips.append(t)
                result[o["order_ref"]] = {"decision": "served", "vehicle_id": s.v["vehicle_id"], "trip_id": t["trip_id"]}
                placed = True
                break
            blockers.add(why)
        if not placed:
            result[o["order_ref"]] = {"decision": "deferred", "reason": _reason(o, blockers)}
    return result, states


def _no_vehicle_reason(o):
    if o["temp_requirement"] == "chilled" and o["parking_constraint"] == "van_only":
        return "reefer_van_unavailable"
    if o["temp_requirement"] == "chilled":
        return "reefer_capacity"
    if o["parking_constraint"] == "van_only":
        return "van_capacity"
    return "fleet_capacity"


def _reason(o, blockers):
    if o["temp_requirement"] == "chilled" and o["parking_constraint"] == "van_only":
        return "reefer_van_capacity"
    if o["temp_requirement"] == "chilled":
        return "reefer_capacity"
    if o["parking_constraint"] == "van_only":
        return "van_capacity"
    if blockers == {"time"} or "time" in blockers and "capacity" not in blockers:
        return "time_budget"
    if "fuel" in blockers and len(blockers) == 1:
        return "fuel_quota"
    return "fleet_capacity"
