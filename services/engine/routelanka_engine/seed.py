"""Seed the database from the shared datasets: reference tables, history-derived tables, the four
accounts and one realistic delivery day (Friday 24 April 2026, a week before Vesak).

The delivery day:
  Peliyagoda orders and fleet availability = the booklet's peak-day scenario S1.
  Kandy orders = the latest historical Friday in a festival ramp, so both depots have a real day.

Runs once on a fresh install (skips if the template day already exists; SEED_FORCE=1 re-seeds).
"""
import hashlib
import json
import os
import sys
from pathlib import Path

import bcrypt
import numpy as np
import pandas as pd
import psycopg
from psycopg.types.json import Jsonb

from .planning import hm, propose

DATA = Path(os.environ.get("DATA_DIR", "/data"))
DEMO_DATE = "2026-04-24"
PERSONAS = dict(
    dispatcher=dict(username="gehiru.dispatch", name="Gehiru", depot="Peliyagoda"),
    loader=dict(username="senash.kandydock", name="Senash", depot="Kandy"),
    driver=dict(username="nimsith.veh041", name="Nimsith"),
    store=dict(username="malika.out029", name="Malika"),
)


def log(*a):
    print("[seed]", *a, flush=True)


def stable(s: str) -> float:
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def read(rel: str) -> pd.DataFrame:
    path = DATA / rel
    if not path.exists():
        sys.exit(f"[seed] missing {path}. Put the competition datasets in ./data (see README).")
    return pd.read_csv(path)


def measure_params(train, legs, outlets, traffic) -> dict:
    """Prediction parameters from the history: handling time, traffic speed and district lateness."""
    dd = train.merge(legs, left_on=["route_id", "seq_in_route"], right_on=["route_id", "seq"], suffixes=("", "_l"))
    dd = dd.merge(outlets[["outlet_id", "dock_type"]], on="outlet_id")
    # Handling starts when the window opens if the truck arrives early (it waits).
    dd["svc"] = dd.leave_outlet_time.map(hm) - dd[["arrival_time", "window_open_time"]].map(hm).max(axis=1)
    svc = dd.groupby(["brand", "dock_type"]).svc.median()
    units = dd.groupby(["brand", "temp_requirement"]).order_units.median()
    late = dd.assign(late=dd.arrival_time.map(hm) > dd.window_close_time.map(hm)).groupby("district").late.mean()
    speed = lambda m: {f"{r.district}|{r.hour}": float(r.speed_index) for r in traffic[traffic.monsoon == m].itertuples()}
    return dict(
        svc_median={f"{b}|{d}": float(v) for (b, d), v in svc.items()},
        units_median={f"{b}|{t}": float(v) for (b, t), v in units.items()},
        district_late_rate={k: float(v) for k, v in late.items()},
        speed_dry=speed(0),
        speed_monsoon=speed(1),
    )


def outlet_history(train, legs) -> dict:
    """Each outlet's last 90 orders on file: on time, late or missed, for the store manager's screen."""
    hj = train.merge(legs[["route_id", "seq", "arrival_time"]], left_on=["route_id", "seq_in_route"], right_on=["route_id", "seq"], how="left")
    arr = hj.arrival_time.map(lambda x: hm(x) if isinstance(x, str) else np.nan)
    hj["state"] = np.where(hj.dispatch_status != "attempted", "missed", np.where(arr > hj.window_close_time.map(hm), "late", "on_time"))
    hj["late_min"] = (arr - hj.window_close_time.map(hm)).where(hj.state == "late")
    out = {}
    for oid, g in hj.sort_values("order_date").groupby("outlet_id"):
        last = g.tail(90)
        runs = g.groupby("order_date").state.agg(lambda x: "missed" if (x == "missed").any() else ("late" if (x == "late").any() else "on_time")).tail(20)
        out[oid] = dict(
            runs=len(last), on_time=round((last.state == "on_time").mean() * 100), late=round((last.state == "late").mean() * 100),
            missed=int((last.state == "missed").sum()), late_median=None if last.late_min.isna().all() else int(last.late_min.median()),
            recent=[dict(date=k, state=v) for k, v in runs.items()], since=last.order_date.min(), until=last.order_date.max())
    return out


def capacity_outlook(train, t1, cal) -> list:
    """Ten weeks ahead: same week last year x this year's growth, against demonstrated refrigerated capacity."""
    allo = pd.concat([train, t1]).merge(cal[["date", "iso_year", "iso_week"]], left_on="order_date", right_on="date")
    allo["chilled"] = allo.order_volume_m3.where(allo.temp_requirement == "chilled", 0)
    wk = allo.groupby(["depot", "iso_year", "iso_week"]).agg(total=("order_volume_m3", "sum"), chilled=("chilled", "sum")).reset_index()
    disp = train[(train.dispatch_status == "attempted") & (train.temp_requirement == "chilled")]
    defer_days = set(train[train.dispatch_status != "attempted"].order_date)
    day_cap = disp[disp.order_date.isin(defer_days)].groupby(["depot", "order_date"]).order_volume_m3.sum().groupby("depot").quantile(0.9).to_dict()
    opdays = cal[cal.is_operating == 1].groupby(["iso_year", "iso_week"]).size().to_dict()
    fest = cal[cal.festival.notna()].groupby(["iso_year", "iso_week"]).festival.first().to_dict()
    pay = cal[cal.is_payday == 1].groupby(["iso_year", "iso_week"]).size().to_dict()
    out = []
    for depot in ["Peliyagoda", "Kandy"]:
        w = wk[wk.depot == depot].set_index(["iso_year", "iso_week"])
        recent = w.loc[(2026, 1):(2026, 13)] if (2026, 1) in w.index else w.tail(13)
        same_ly = w.loc[[(2025, i) for i in range(1, 14) if (2025, i) in w.index]]
        growth = recent.total.mean() / same_ly.total.mean()
        for wkno in range(17, 27):
            ly = w.loc[(2025, wkno)] if (2025, wkno) in w.index else recent.mean()
            od = opdays.get((2026, wkno), 6)
            scale = growth * od / max(opdays.get((2025, wkno), 6), 1)
            out.append(dict(depot=depot, iso_year=2026, iso_week=wkno, total=round(ly.total * scale), chilled=round(ly.chilled * scale),
                            chilled_capacity=round(day_cap.get(depot, 0) * od), operating_days=od,
                            festival=fest.get((2026, wkno), ""), paydays=pay.get((2026, wkno), 0)))
    return out


def demo_day_orders(s1, train, outlets, cal) -> tuple[list, str]:
    oc = ["outlet_id", "dock_type", "parking_constraint", "mall_window", "window_open_time", "window_close_time"]
    fridays = cal[(cal.dow == 4) & (cal.festival_ramp > 0) & (cal.date < "2026-02-15")].date
    kdate = [d for d in fridays if ((train.order_date == d) & (train.depot == "Kandy")).sum() > 30][-1]
    k = train[(train.order_date == kdate) & (train.depot == "Kandy")].copy()
    k = k.drop(columns=["window_open_time", "window_close_time"]).merge(outlets[oc], on="outlet_id")
    k["order_ref"] = [f"K1-{i:03d}" for i in range(len(k))]
    k["deferred_yesterday"] = 0
    k["days_since_last_served"] = 1
    cols = ["order_ref", "outlet_id", "brand", "district", "depot", "dock_type", "parking_constraint", "mall_window",
            "window_open_time", "window_close_time", "temp_requirement", "order_units", "order_weight_kg",
            "order_volume_m3", "deferred_yesterday", "days_since_last_served"]
    orders = pd.concat([s1[cols], k[cols]]).reset_index(drop=True)
    orders["mall_window"] = orders.mall_window.fillna("")
    return orders.to_dict("records"), kdate


def copy_rows(cur, table: str, cols: list, rows):
    with cur.copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN") as cp:
        for r in rows:
            cp.write_row(r)


def main():
    url = os.environ["DATABASE_URL"]
    force = os.environ.get("SEED_FORCE") == "1"
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM workspaces WHERE is_template")
        if cur.fetchone()[0] and not force:
            log("already seeded; skipping (set SEED_FORCE=1 to rebuild)")
            return
        if force:
            log("SEED_FORCE=1: clearing existing data")
            cur.execute("TRUNCATE workspaces, users, engine_params, capacity_outlook, outlet_history, road_conditions, calendar, service_allowance, districts, vehicles, outlets, processed_messages CASCADE")

        log("reading datasets from", DATA)
        outlets = read("General Data/outlets.csv")
        vehicles = read("General Data/vehicles.csv")
        cal = read("General Data/calendar.csv")
        dist = read("General Data/district_travel.csv")
        allow_df = read("General Data/service_allowance.csv")
        traffic = read("General Data/traffic_speed.csv")
        roads = read("General Data/road_conditions.csv")
        s1 = read("Test Data/task2b_peak_day_scenarios.csv")
        fleet = read("Test Data/task2b_peak_day_fleet.csv")
        train = read("Training Data/deliveries_train.csv")
        legs = read("Training Data/route_legs_train.csv")
        t1 = read("Test Data/task1_test_inputs.csv")

        log("reference tables")
        copy_rows(cur, "outlets", list(outlets.columns), outlets.fillna("").itertuples(index=False))
        copy_rows(cur, "vehicles", list(vehicles.columns), vehicles.itertuples(index=False))
        copy_rows(cur, "districts", list(dist.columns), dist.itertuples(index=False))
        copy_rows(cur, "service_allowance", ["brand", "dock_type", "minutes"], allow_df.itertuples(index=False))
        c = cal.copy()
        c["festival"] = c.festival.fillna("")
        for b in ["is_payday", "is_holiday", "monsoon", "is_operating"]:
            c[b] = c[b].astype(bool)
        copy_rows(cur, "calendar", ["date", "dow", "iso_year", "iso_week", "is_payday", "festival", "festival_ramp", "is_holiday", "monsoon", "is_operating"],
                  c[["date", "dow", "iso_year", "iso_week", "is_payday", "festival", "festival_ramp", "is_holiday", "monsoon", "is_operating"]].itertuples(index=False))
        copy_rows(cur, "road_conditions", ["district", "date", "disruption_index"], roads[["district", "date", "disruption_index"]].itertuples(index=False))

        log("measuring prediction parameters from the history")
        params = measure_params(train, legs, outlets, traffic)
        cur.execute("INSERT INTO engine_params (key, value) VALUES ('predictions', %s)", [Jsonb(params)])
        copy_rows(cur, "outlet_history", ["outlet_id", "summary"], ((k, Jsonb(v)) for k, v in outlet_history(train, legs).items()))
        ol = capacity_outlook(train, t1, cal)
        copy_rows(cur, "capacity_outlook", list(ol[0].keys()), (tuple(r.values()) for r in ol))

        log("building the delivery day", DEMO_DATE)
        orders, kdate = demo_day_orders(s1, train, outlets, cal)
        status = dict(zip(fleet.vehicle_id, fleet.status))
        veh = vehicles.to_dict("records")
        for v in veh:
            v["status"] = status.get(v["vehicle_id"], "available")
            # Monday to Thursday already driven: half to two thirds of the weekly quota used.
            v["fuel_used_l"] = round(v["weekly_fuel_quota_l"] * (0.50 + 0.15 * stable(v["vehicle_id"])), 1)
        dtravel = dist.set_index("district").to_dict("index")
        allow = {(r.brand, r.dock_type): r.service_allowance_min for r in allow_df.itertuples()}
        monsoon = bool(cal.set_index("date").loc[DEMO_DATE, "monsoon"])
        assignments, trips = propose(orders, veh, dtravel, allow, params, monsoon)

        # The demo personas: a Nuwara Eliya Fresh run from Kandy for the driver, a Gampaha store.
        ne = [t for t in trips if t["district"] == "Nuwara Eliya" and t["brand"] == "Fresh"]
        by_ref = {a["order_ref"]: a for a in assignments}
        count = lambda t: sum(1 for a in assignments if a.get("vehicle_id") == t["vehicle_id"] and a.get("trip_id") == t["trip_id"])
        drv = max(ne, key=count)
        store = next(o for o in orders if o["district"] == "Gampaha" and o["brand"] == "Fresh" and o["temp_requirement"] == "chilled" and by_ref[o["order_ref"]]["decision"] == "deferred")
        meta = dict(dow="Friday", festival="Vesak", festival_date="2026-05-01", kandy_source_date=kdate, monsoon=int(monsoon),
                    fresh_budget=270, day_budget=480, cutoff="16:00",
                    personas=dict(dispatcher=dict(name="Gehiru", depot="Peliyagoda"), loader=dict(name="Senash", depot="Kandy"),
                                  driver=dict(name="Nimsith", vehicle_id=drv["vehicle_id"], trip_id=drv["trip_id"]),
                                  store=dict(name="Malika", outlet_id=store["outlet_id"])))

        cur.execute("INSERT INTO workspaces (name, service_date, is_template, meta) VALUES ('Template: Friday 24 April 2026', %s, true, %s) RETURNING id",
                    [DEMO_DATE, Jsonb(meta)])
        tpl = cur.fetchone()[0]
        copy_rows(cur, "vehicle_day", ["workspace_id", "vehicle_id", "status", "fuel_used_l"], ((tpl, v["vehicle_id"], v["status"], v["fuel_used_l"]) for v in veh))
        copy_rows(cur, "orders", ["workspace_id", "order_ref", "outlet_id", "brand", "district", "depot", "temp_requirement", "order_units",
                                  "order_weight_kg", "order_volume_m3", "deferred_yesterday", "days_since_last_served", "run_date", "source"],
                  ((tpl, o["order_ref"], o["outlet_id"], o["brand"], o["district"], o["depot"], o["temp_requirement"], int(o["order_units"]),
                    float(o["order_weight_kg"]), float(o["order_volume_m3"]), int(o["deferred_yesterday"]), int(o["days_since_last_served"]), DEMO_DATE, "seed") for o in orders))
        acols = ["decision", "reason", "vehicle_id", "trip_id", "stop_seq", "plan_arrival", "pred_arrival", "pred_window", "pred_service_min", "pred_late_prob", "priority"]
        copy_rows(cur, "assignments", ["workspace_id", "order_ref", *acols], ((tpl, a["order_ref"], *[a.get(c) for c in acols]) for a in assignments))
        tcols = ["vehicle_id", "trip_id", "brand", "district", "depot", "depart", "minutes", "km", "fuel_l"]
        copy_rows(cur, "trips", ["workspace_id", *tcols], ((tpl, *[t[c] for c in tcols]) for t in trips))
        cur.execute("INSERT INTO order_progress (workspace_id, order_ref) SELECT %s, order_ref FROM orders WHERE workspace_id = %s", [tpl, tpl])
        cur.execute("INSERT INTO driver_status (workspace_id, vehicle_id) VALUES (%s, %s)", [tpl, drv["vehicle_id"]])
        cur.execute("SELECT clone_template_day('Friday 24 April 2026', true)")
        default_day = cur.fetchone()[0]
        cur.execute("INSERT INTO events (workspace_id, type, actor_role, text, at, in_feed) VALUES (%s, 'day.created', 'dispatcher', 'Demo day created', '03:00', false)", [default_day])

        log("accounts")
        pw = os.environ.get("SEED_PASSWORD", "routelanka").encode()
        users = [
            ("dispatcher", PERSONAS["dispatcher"], dict(depot="Peliyagoda")),
            ("loader", PERSONAS["loader"], dict(depot="Kandy")),
            ("driver", PERSONAS["driver"], dict(vehicle_id=drv["vehicle_id"], trip_id=drv["trip_id"], depot="Kandy")),
            ("store", PERSONAS["store"], dict(outlet_id=store["outlet_id"])),
        ]
        for role, p, extra in users:
            cur.execute("INSERT INTO users (username, password_hash, role, display_name, depot, outlet_id, vehicle_id, trip_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        [p["username"], bcrypt.hashpw(pw, bcrypt.gensalt(10)).decode(), role, p["name"], extra.get("depot"), extra.get("outlet_id"), extra.get("vehicle_id"), extra.get("trip_id")])

        served = sum(a["decision"] == "served" for a in assignments)
        log(f"done: {len(orders)} orders ({served} served, {len(orders) - served} deferred), {len(trips)} trips; "
            f"driver {drv['vehicle_id']} trip {drv['trip_id']}, store {store['outlet_id']}")


if __name__ == "__main__":
    main()
