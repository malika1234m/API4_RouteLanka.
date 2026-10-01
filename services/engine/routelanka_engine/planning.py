"""Turn an allocation into runnable trips: stop order, departure times and predicted arrivals.

`allocate` (engine.py) decides which orders go on which vehicle and trip. This module orders the stops
inside each trip, gives each trip its departure time, and predicts arrival and lateness per stop from
parameters measured on the delivery history (see `measure_params` in seed.py).
"""
import itertools
import math

from .engine import allocate, priority, trip_km, trip_minutes

FRESH_START, DAY_START = "03:30", "07:30"


def hm(s: str) -> int:
    return int(s[:2]) * 60 + int(s[3:5])


def fmt(m: float) -> str:
    return f"{int(m) // 60 % 24:02d}:{int(m) % 60:02d}"


def predict_service(o: dict, params: dict) -> float:
    """Predicted handling time: the outlet's own history (or the brand and dock type's, for an outlet with none),
    scaled by how this order compares with the outlet's usual size."""
    own = params.get("outlet_svc", {}).get(o["outlet_id"])
    if own is not None:
        base, typical, lo, hi = own, params["outlet_units"][o["outlet_id"]], 0.6, 1.8
    else:
        base = params["svc_median"][f"{o['brand']}|{o['dock_type']}"]
        typical, lo, hi = params["units_median"][f"{o['brand']}|{o['temp_requirement']}"], 0.75, 1.5
    f = 0.6 + 0.4 * o["order_units"] / max(typical, 1)
    return round(base * min(max(f, lo), hi), 1)


def late_probability(slack_min: float, district_late_rate: float) -> float:
    """Chance of arriving after the window closes, from the minutes of slack left and the district's record."""
    return 1 / (1 + math.exp(slack_min / 14 - 0.8 + 2.5 * district_late_rate))


EXHAUSTIVE_STOPS = 7  # up to 7! = 5040 orders per trip; larger trips use pairwise swaps
# Keep earliest-closing-first unless another order saves at least this many expected late stops. Below it, a new
# order mostly swaps which store is late, and an order drivers and stores recognise is worth more than that.
MIN_GAIN = 0.25


def _run_stops(stops: list, depart: float, d: dict, brand: str, allowance: dict, params: dict, speed: dict, district: str, late_rate: float):
    """Drive the stops in this order. Returns (expected late stops, per-order predictions).

    Planned times use the dispatcher's free-flow minutes and allowances; predicted times slow each leg by the
    district's traffic for that hour and use the predicted handling time. A vehicle that arrives early waits
    for the window to open.
    """
    plan_t = pred_t = depart
    expected_late, out = 0.0, {}
    for n, stop in enumerate(stops, start=1):
        leg = d["depot_to_district_freeflow_min"] if n == 1 else d["inter_stop_freeflow_min"]
        plan_t += leg
        pred_t += leg * 100 / max(speed.get(f"{district}|{int(pred_t // 60) % 24}", 100), 30)
        plan_arr, pred_arr = plan_t, pred_t
        for o in stop:  # several orders for one outlet are one stop
            wo, wc = hm(o["window_open_time"]), hm(o["window_close_time"])
            plan_t = max(plan_t, wo) + allowance[(brand, o["dock_type"])]
            sv = predict_service(o, params)
            pred_t = max(pred_t, wo) + sv
            p_late = late_probability(wc - pred_arr, late_rate)
            expected_late += p_late
            out[o["order_ref"]] = dict(
                stop_seq=n, plan_arrival=fmt(plan_arr), pred_arrival=fmt(pred_arr),
                pred_window=f"{fmt(pred_arr - 10)}-{fmt(pred_arr + 20)}", pred_service_min=sv, pred_late_prob=round(p_late, 2))
    return expected_late, out


def best_stop_order(orders: list, run) -> list:
    """The stop order with the fewest expected late arrivals.

    Starts from earliest-closing window first (a good order on its own) and keeps it unless another order saves at
    least MIN_GAIN expected late stops: every order for trips of up to EXHAUSTIVE_STOPS stops, pairwise swaps beyond.
    """
    stops: dict = {}
    for o in sorted(orders, key=lambda o: (hm(o["window_close_time"]), hm(o["window_open_time"]), o["outlet_id"], o["temp_requirement"])):
        stops.setdefault(o["outlet_id"], []).append(o)
    edd = list(stops.values())
    edd_cost = run(edd)[0]
    order, best = edd, edd_cost
    if len(order) <= EXHAUSTIVE_STOPS:
        for perm in itertools.permutations(order):
            cost = run(list(perm))[0]
            if cost < best - 1e-9:
                best, order = cost, list(perm)
        return order if best <= edd_cost - MIN_GAIN else edd
    improved = True
    while improved:
        improved = False
        for i in range(len(order) - 1):
            for j in range(i + 1, len(order)):
                cand = order[:i] + [order[j]] + order[i + 1:j] + [order[i]] + order[j + 1:]
                cost = run(cand)[0]
                if cost < best - 1e-9:
                    best, order, improved = cost, cand, True
    return order if best <= edd_cost - MIN_GAIN else edd


def sequence_trips(states: dict, dtravel: dict, allowance: dict, params: dict, monsoon: bool):
    """Order each trip's stops to keep stores' windows and predict arrivals.

    Returns (trips, per_order) where per_order maps order_ref to its stop number, planned and
    predicted arrival, arrival window, predicted handling time and lateness risk.
    """
    speed = params["speed_monsoon" if monsoon else "speed_dry"]
    late_rates = params["district_late_rate"]
    trips_out, per_order = [], {}
    for vid, s in states.items():
        fresh_clock, day_clock = hm(FRESH_START), hm(DAY_START)
        for t in s.trips:
            fresh = t["brand"] == "Fresh"
            d = dtravel[t["district"]]
            depart = fresh_clock if fresh else day_clock

            def run(stops, depart=depart, d=d, t=t):
                return _run_stops(stops, depart, d, t["brand"], allowance, params, speed, t["district"], late_rates.get(t["district"], 0.2))

            stops = best_stop_order(t["orders"], run)
            t["orders"] = [o for stop in stops for o in stop]
            per_order.update(run(stops)[1])
            mins = trip_minutes(t, dtravel, allowance)
            back = depart + mins + d["depot_to_district_freeflow_min"]
            if fresh:
                fresh_clock = back
            else:
                day_clock = back
            km = trip_km(t, dtravel)
            trips_out.append(dict(
                vehicle_id=vid, trip_id=t["trip_id"], brand=t["brand"], district=t["district"], depot=s.v["depot"],
                depart=fmt(depart), minutes=round(mins), km=round(km, 1), fuel_l=round(km / s.v["km_per_l"], 1)))
    return trips_out, per_order


def propose(orders: list, vehicles: list, dtravel: dict, allowance: dict, params: dict, monsoon: bool):
    """Full proposal for a day: allocation, deferral reasons, trips and predictions.

    `vehicles` carry `status` and `fuel_used_l` for the day. Returns (assignments, trips) where
    assignments has one entry per order.
    """
    available = {v["vehicle_id"] for v in vehicles if v["status"] == "available"}
    fuel_left = {v["vehicle_id"]: v["weekly_fuel_quota_l"] - v["fuel_used_l"] for v in vehicles}
    result, states = allocate(orders, vehicles, available, dtravel, allowance, fuel_left)
    trips, per_order = sequence_trips(states, dtravel, allowance, params, monsoon)
    assignments = []
    for o in orders:
        a = dict(order_ref=o["order_ref"], priority=priority(o), **result[o["order_ref"]])
        a.update(per_order.get(o["order_ref"], {}))
        assignments.append(a)
    return assignments, trips
