"""Turn an allocation into runnable trips: stop order, departure times and predicted arrivals.

`allocate` (engine.py) decides which orders go on which vehicle and trip. This module orders the stops
inside each trip, gives each trip its departure time, and predicts arrival and lateness per stop from
parameters measured on the delivery history (see `measure_params` in seed.py).
"""
import math

from .engine import allocate, priority, trip_km, trip_minutes

FRESH_START, DAY_START = "03:30", "07:30"


def hm(s: str) -> int:
    return int(s[:2]) * 60 + int(s[3:5])


def fmt(m: float) -> str:
    return f"{int(m) // 60 % 24:02d}:{int(m) % 60:02d}"


def predict_service(o: dict, params: dict) -> float:
    """Predicted handling time: the history's median for the brand and dock type, scaled by order size."""
    base = params["svc_median"][f"{o['brand']}|{o['dock_type']}"]
    typical = params["units_median"][f"{o['brand']}|{o['temp_requirement']}"]
    f = 0.6 + 0.4 * o["order_units"] / typical
    return round(base * min(max(f, 0.75), 1.5), 1)


def late_probability(slack_min: float, district_late_rate: float) -> float:
    """Chance of arriving after the window closes, from the minutes of slack left and the district's record."""
    return 1 / (1 + math.exp(slack_min / 14 - 0.8 + 2.5 * district_late_rate))


def sequence_trips(states: dict, dtravel: dict, allowance: dict, params: dict, monsoon: bool):
    """Order each trip's stops by delivery window and predict arrivals.

    Returns (trips, per_order) where per_order maps order_ref to its stop number, planned and
    predicted arrival, arrival window and lateness risk.
    """
    speed = params["speed_monsoon" if monsoon else "speed_dry"]
    late_rate = params["district_late_rate"]
    trips_out, per_order = [], {}
    for vid, s in states.items():
        fresh_clock, day_clock = hm(FRESH_START), hm(DAY_START)
        for t in s.trips:
            t["orders"].sort(key=lambda o: (hm(o["window_close_time"]), hm(o["window_open_time"]), o["outlet_id"], o["temp_requirement"]))
            fresh = t["brand"] == "Fresh"
            d = dtravel[t["district"]]
            depart = fresh_clock if fresh else day_clock
            plan_t = pred_t = depart
            stop_no, prev_outlet = 0, None
            plan_arr = pred_arr = depart
            for i, o in enumerate(t["orders"]):
                same = o["outlet_id"] == prev_outlet  # a second order for the same outlet is the same stop
                stop_no += 0 if same else 1
                prev_outlet = o["outlet_id"]
                leg = 0 if same else d["depot_to_district_freeflow_min"] if i == 0 else d["inter_stop_freeflow_min"]
                plan_t += leg
                slow = 100 / max(speed.get(f"{t['district']}|{int(pred_t // 60) % 24}", 100), 30)
                pred_t += leg * slow
                wo, wc = hm(o["window_open_time"]), hm(o["window_close_time"])
                if not same:
                    plan_arr, pred_arr = plan_t, pred_t
                plan_t = max(plan_t, wo) + allowance[(t["brand"], o["dock_type"])]
                sv = predict_service(o, params)
                pred_t = max(pred_t, wo) + sv
                p_late = late_probability(wc - pred_arr, late_rate.get(t["district"], 0.2))
                per_order[o["order_ref"]] = dict(
                    stop_seq=stop_no, plan_arrival=fmt(plan_arr), pred_arrival=fmt(pred_arr),
                    pred_window=f"{fmt(pred_arr - 10)}-{fmt(pred_arr + 20)}", pred_service_min=sv,
                    pred_late_prob=round(p_late, 2))
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
