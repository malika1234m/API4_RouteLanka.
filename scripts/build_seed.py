"""Build the prototype seed (apps/web/src/data/seed.json) from the shared datasets.

Demo day: Fri 24 Apr 2026 - Vesak is one week away, not a payday.
  Peliyagoda orders + fleet = Task 2B scenario S1 (the booklet's peak day).
  Kandy orders = the latest real historical Friday in the festival ramp.
"""
import json, math, os, hashlib
from pathlib import Path
import pandas as pd
from engine import allocate, trip_minutes, trip_km, priority

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("DATA_DIR", ROOT.parent / "data"))
OUT = ROOT / "apps/web/src/data/seed.json"
DEMO_DATE = "2026-04-24"

g = lambda p: pd.read_csv(DATA / p)
outlets = g("General Data/outlets.csv")
vehicles = g("General Data/vehicles.csv")
cal = g("General Data/calendar.csv")
dtravel = g("General Data/district_travel.csv").set_index("district").to_dict("index")
allow = {(r.brand, r.dock_type): r.service_allowance_min for r in g("General Data/service_allowance.csv").itertuples()}
traffic = g("General Data/traffic_speed.csv")
s1 = g("Test Data/task2b_peak_day_scenarios.csv")
fleet = g("Test Data/task2b_peak_day_fleet.csv")
train = g("Training Data/deliveries_train.csv")
legs = g("Training Data/route_legs_train.csv")
t1 = g("Test Data/task1_test_inputs.csv")

hm = lambda s: int(s[:2]) * 60 + int(s[3:5])
fmt = lambda m: f"{int(m) // 60 % 24:02d}:{int(m) % 60:02d}"
stable = lambda s: int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

# ---------- orders for the demo day ----------
oc = ["outlet_id", "dock_type", "parking_constraint", "mall_window", "window_open_time", "window_close_time"]
pel = s1.copy()

cal_d = cal.set_index("date")
fridays = cal[(cal.dow == 4) & (cal.festival_ramp > 0) & (cal.date < "2026-02-15")].date
kdate = [d for d in fridays if ((train.order_date == d) & (train.depot == "Kandy")).sum() > 30][-1]
k = train[(train.order_date == kdate) & (train.depot == "Kandy")].copy()
k = k.drop(columns=["window_open_time", "window_close_time"]).merge(outlets[oc], on="outlet_id")
k["order_ref"] = [f"K1-{i:03d}" for i in range(len(k))]
k["scenario"] = "K1"
k["deferred_yesterday"] = 0
k["days_since_last_served"] = 1

cols = ["order_ref", "outlet_id", "brand", "district", "depot", "dock_type", "parking_constraint", "mall_window",
        "window_open_time", "window_close_time", "temp_requirement", "order_units", "order_weight_kg",
        "order_volume_m3", "deferred_yesterday", "days_since_last_served"]
orders = pd.concat([pel[cols], k[cols]]).reset_index(drop=True)
orders["mall_window"] = orders.mall_window.fillna("")
orders = orders.to_dict("records")

# ---------- fleet state ----------
status = dict(zip(fleet.vehicle_id, fleet.status))
veh = vehicles.to_dict("records")
for v in veh:
    v["status"] = status.get(v["vehicle_id"], "available")
    used = 0.50 + 0.15 * stable(v["vehicle_id"])  # Mon-Thu already driven
    v["fuel_used_l"] = round(v["weekly_fuel_quota_l"] * used, 1)
available = {v["vehicle_id"] for v in veh if v["status"] == "available"}
fuel_left = {v["vehicle_id"]: v["weekly_fuel_quota_l"] - v["fuel_used_l"] for v in veh}

result, states = allocate(orders, veh, available, dtravel, allow, fuel_left)

# ---------- predicted service time (history, per brand x dock, scaled by size) ----------
dd = train.merge(legs, left_on=["route_id", "seq_in_route"], right_on=["route_id", "seq"], suffixes=("", "_l"))
dd = dd.merge(outlets[["outlet_id", "dock_type"]], on="outlet_id")
dd["svc"] = dd.leave_outlet_time.map(hm) - dd[["arrival_time", "window_open_time"]].map(hm).max(axis=1)
svc_med = dd.groupby(["brand", "dock_type"]).svc.median().to_dict()
units_med = dd.groupby(["brand", "temp_requirement"]).order_units.median().to_dict()


def pred_service(o):
    base = svc_med[(o["brand"], o["dock_type"])]
    f = 0.6 + 0.4 * o["order_units"] / units_med[(o["brand"], o["temp_requirement"])]
    return round(base * min(max(f, 0.75), 1.5), 1)


demo_monsoon = int(cal_d.loc[DEMO_DATE, "monsoon"])
spd = traffic[traffic.monsoon == demo_monsoon].set_index(["district", "hour"]).speed_index.to_dict()
late_rate_hist = dd.assign(late=dd.arrival_time.map(hm) > dd.window_close_time.map(hm)).groupby("district").late.mean().to_dict()

# ---------- build trips with stop sequence, plan and predicted ETAs ----------
trips_out, order_extra = [], {}
for vid, s in states.items():
    fresh_clock, day_clock = hm("03:30"), hm("07:30")
    for t in s.trips:
        t["orders"].sort(key=lambda o: (hm(o["window_close_time"]), hm(o["window_open_time"]), o["outlet_id"], o["temp_requirement"]))
        fresh = t["brand"] == "Fresh"
        d = dtravel[t["district"]]
        depart = fresh_clock if fresh else day_clock
        plan_t = pred_t = depart
        stops, stop_no, prev_outlet = [], 0, None
        for i, o in enumerate(t["orders"]):
            same = o["outlet_id"] == prev_outlet  # a second order for the same outlet is the same stop
            stop_no += 0 if same else 1
            prev_outlet = o["outlet_id"]
            leg = 0 if same else d["depot_to_district_freeflow_min"] if i == 0 else d["inter_stop_freeflow_min"]
            plan_t += leg
            slow = 100 / max(spd.get((t["district"], int(pred_t // 60) % 24), 100), 30)
            pred_t += leg * slow
            wo, wc = hm(o["window_open_time"]), hm(o["window_close_time"])
            if not same:
                plan_arr, pred_arr = plan_t, pred_t
            plan_t = max(plan_t, wo) + allow[(t["brand"], o["dock_type"])]
            sv = pred_service(o)
            pred_t = max(pred_t, wo) + sv
            slack = wc - pred_arr
            p_late = 1 / (1 + math.exp(slack / 14 - 0.8 + 2.5 * late_rate_hist.get(t["district"], .2)))
            order_extra[o["order_ref"]] = dict(stop_seq=stop_no, plan_arrival=fmt(plan_arr), pred_arrival=fmt(pred_arr),
                                               pred_window=f"{fmt(pred_arr - 10)}-{fmt(pred_arr + 20)}",
                                               pred_service_min=sv, pred_late_prob=round(p_late, 2))
            stops.append(o["order_ref"])
        mins = trip_minutes(t, dtravel, allow)
        ret = d["depot_to_district_freeflow_min"]
        if fresh:
            fresh_clock = depart + mins + ret
        else:
            day_clock = depart + mins + ret
        trips_out.append(dict(vehicle_id=vid, trip_id=t["trip_id"], brand=t["brand"], district=t["district"],
                              depot=s.v["depot"], stops=stops, depart=fmt(depart), minutes=round(mins),
                              volume_m3=round(sum(o["order_volume_m3"] for o in t["orders"]), 2),
                              weight_kg=round(sum(o["order_weight_kg"] for o in t["orders"]), 1),
                              km=round(trip_km(t, dtravel), 1),
                              fuel_l=round(trip_km(t, dtravel) / s.v["km_per_l"], 1)))

for o in orders:
    o.update(result[o["order_ref"]])
    o.update(order_extra.get(o["order_ref"], {}))
    o["priority"] = priority(o)

# ---------- capacity outlook: weekly demand history + seasonal-naive forecast ----------
allo = pd.concat([train, t1]).merge(cal[["date", "iso_year", "iso_week"]], left_on="order_date", right_on="date")
allo["chilled"] = allo.order_volume_m3.where(allo.temp_requirement == "chilled", 0)
wk = allo.groupby(["depot", "iso_year", "iso_week"]).agg(total=("order_volume_m3", "sum"), chilled=("chilled", "sum")).reset_index()
# demonstrated chilled capacity: 90th pct of chilled m3 actually dispatched same-day on days that had deferrals
disp = train[(train.dispatch_status == "attempted") & (train.temp_requirement == "chilled")]
defer_days = set(train[train.dispatch_status != "attempted"].order_date)
day_cap = disp[disp.order_date.isin(defer_days)].groupby(["depot", "order_date"]).order_volume_m3.sum().groupby("depot").quantile(0.9).to_dict()
opdays = cal[cal.is_operating == 1].groupby(["iso_year", "iso_week"]).size().to_dict()
fest = cal[cal.festival.notna()].groupby(["iso_year", "iso_week"]).festival.first().to_dict()
pay = cal[cal.is_payday == 1].groupby(["iso_year", "iso_week"]).size().to_dict()
outlook = []
for depot in ["Peliyagoda", "Kandy"]:
    w = wk[wk.depot == depot].set_index(["iso_year", "iso_week"])
    recent = w.loc[(2026, 1):(2026, 13)] if (2026, 1) in w.index else w.tail(13)
    same_ly = w.loc[[(2025, i) for i in range(1, 14) if (2025, i) in w.index]]
    growth = recent.total.mean() / same_ly.total.mean()
    for wkno in range(17, 27):
        ly = w.loc[(2025, wkno)] if (2025, wkno) in w.index else recent.mean()
        od = opdays.get((2026, wkno), 6)
        outlook.append(dict(depot=depot, iso_week=wkno, total=round(ly.total * growth * od / max(opdays.get((2025, wkno), 6), 1), 0),
                            chilled=round(ly.chilled * growth * od / max(opdays.get((2025, wkno), 6), 1), 0),
                            chilled_capacity=round(day_cap.get(depot, 0) * od, 0), operating_days=od,
                            festival=fest.get((2026, wkno), ""), paydays=pay.get((2026, wkno), 0)))

# ---------- personas ----------
store = next(o for o in orders if o["district"] == "Gampaha" and o["brand"] == "Fresh" and o["temp_requirement"] == "chilled" and o["decision"] == "deferred") \
    if any(o["district"] == "Gampaha" and o["decision"] == "deferred" for o in orders) else next(o for o in orders if o["district"] == "Gampaha")
ne = [t for t in trips_out if t["district"] == "Nuwara Eliya" and t["brand"] == "Fresh"]
drv = max(ne, key=lambda t: len(t["stops"])) if ne else max(trips_out, key=lambda t: len(t["stops"]))

seed = dict(
    meta=dict(date=DEMO_DATE, dow="Friday", festival="Vesak", festival_date="2026-05-01", kandy_source_date=kdate,
              monsoon=demo_monsoon, fresh_budget=270, day_budget=480, cutoff="16:00"),
    personas=dict(dispatcher=dict(name="Gehiru", depot="Peliyagoda"),
                  loader=dict(name="Senash", depot=drv["depot"]),
                  driver=dict(name="Nimsith", vehicle_id=drv["vehicle_id"], trip_id=drv["trip_id"]),
                  store=dict(name="Malika", outlet_id=store["outlet_id"])),
    outlets=outlets.fillna("").to_dict("records"),
    vehicles=veh, districts=[dict(district=k, **v) for k, v in dtravel.items()],
    allowance=[dict(brand=b, dock_type=d, minutes=m) for (b, d), m in allow.items()],
    orders=orders, trips=trips_out, outlook=outlook)
# ---------- per-outlet delivery record (last 90 orders on file) for the store manager ----------
import numpy as np
hj = train.merge(legs[["route_id", "seq", "arrival_time"]], left_on=["route_id", "seq_in_route"], right_on=["route_id", "seq"], how="left")
arr = hj.arrival_time.map(lambda x: hm(x) if isinstance(x, str) else np.nan)
hj["state"] = np.where(hj.dispatch_status != "attempted", "missed", np.where(arr > hj.window_close_time.map(hm), "late", "on_time"))
hj["late_min"] = (arr - hj.window_close_time.map(hm)).where(hj.state == "late")
hist = {}
for oid, g in hj.sort_values("order_date").groupby("outlet_id"):
    last = g.tail(90)
    runs = g.groupby("order_date").state.agg(lambda x: "missed" if (x == "missed").any() else ("late" if (x == "late").any() else "on_time")).tail(20)
    hist[oid] = dict(runs=len(last), on_time=round((last.state == "on_time").mean() * 100), late=round((last.state == "late").mean() * 100),
                     missed=int((last.state == "missed").sum()), late_median=None if last.late_min.isna().all() else int(last.late_min.median()),
                     recent=[dict(date=k, state=v) for k, v in runs.items()], since=last.order_date.min(), until=last.order_date.max())
seed["outlet_history"] = hist
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(seed, indent=1, default=lambda x: x.item() if hasattr(x, "item") else str(x)))

# ---------- report ----------
o = pd.DataFrame(orders)
print("kandy source date", kdate)
print(o.groupby(["depot", "decision"]).size().to_string())
print(o[o.decision == "deferred"].groupby(["depot", "brand", "temp_requirement", "reason"]).size().to_string())
print("driver trip", drv["vehicle_id"], drv["trip_id"], drv["district"], len(drv["stops"]), "| store", store["outlet_id"], store["decision"])
print("trips", len(trips_out), "->", OUT)
