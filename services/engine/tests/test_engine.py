"""Engine tests.

Unit tests use small made-up data. The integration test allocates the booklet's peak day (scenario S1)
and runs the organisers' check_allocation.py on the result; it runs when the datasets are available
(DATA_DIR) and the checker is found (CHECKER, default: next to the data folder).
"""
import csv
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from routelanka_engine.engine import allocate, trip_minutes
from routelanka_engine.planning import propose

DTRAVEL = {
    "Gampaha": dict(depot_to_district_freeflow_min=37, inter_stop_freeflow_min=9, depot_to_district_km=28, inter_stop_km=7),
    "Colombo": dict(depot_to_district_freeflow_min=24, inter_stop_freeflow_min=8, depot_to_district_km=12, inter_stop_km=4),
}
ALLOW = {("Fresh", "rear_dock"): 15, ("Fresh", "street"): 16, ("Style", "mall_bay"): 30}


def veh(vid, temp="ambient", type_="truck", vol=20, kg=5000):
    return dict(vehicle_id=vid, type=type_, temp=temp, weight_cap_kg=kg, volume_cap_m3=vol, km_per_l=5, weekly_fuel_quota_l=400, fuel_used_l=0, depot="Peliyagoda", status="available")


def order(ref, **kw):
    o = dict(order_ref=ref, outlet_id="OUT" + ref, brand="Fresh", district="Gampaha", depot="Peliyagoda", dock_type="rear_dock",
             parking_constraint="normal", mall_window="", window_open_time="05:00", window_close_time="08:00",
             temp_requirement="ambient", order_units=10, order_weight_kg=100, order_volume_m3=1,
             deferred_yesterday=0, days_since_last_served=1)
    o.update(kw)
    return o


def run(orders, vehicles):
    return allocate(orders, vehicles, {v["vehicle_id"] for v in vehicles}, DTRAVEL, ALLOW, {v["vehicle_id"]: 400 for v in vehicles})[0]


def test_trip_minutes_matches_the_booklet_example():
    trip = dict(brand="Fresh", district="Gampaha", orders=[order("a"), order("b"), order("c", dock_type="street")])
    assert trip_minutes(trip, DTRAVEL, ALLOW) == 101


def test_chilled_goes_on_a_reefer_and_the_reason_is_recorded_when_none_is_free():
    assert run([order("c", temp_requirement="chilled")], [veh("T1")])["c"] == {"decision": "deferred", "reason": "reefer_capacity"}
    assert run([order("c", temp_requirement="chilled")], [veh("T1"), veh("R1", temp="reefer")])["c"]["vehicle_id"] == "R1"


def test_van_only_outlets_get_a_van():
    assert run([order("v", parking_constraint="van_only")], [veh("T1"), veh("V1", type_="van", vol=8)])["v"]["vehicle_id"] == "V1"


def test_orders_larger_than_any_vehicle_are_deferred_with_fleet_capacity():
    assert run([order("big", order_volume_m3=40)], [veh("T1")])["big"] == {"decision": "deferred", "reason": "fleet_capacity"}


def test_skipped_yesterday_outlets_go_first_when_space_is_short():
    orders = [order("new", order_volume_m3=15), order("skipped", order_volume_m3=15, deferred_yesterday=1)]
    # One vehicle with room for one of them per trip, and both trips' time only fits... the skipped outlet goes first.
    r = run(orders, [veh("T1", vol=16)])
    assert r["skipped"]["decision"] == "served"


def test_propose_gives_every_served_stop_a_sequence_and_prediction():
    params = dict(svc_median={"Fresh|rear_dock": 17}, units_median={"Fresh|ambient": 10}, district_late_rate={"Gampaha": 0.1}, speed_dry={}, speed_monsoon={})
    assignments, trips = propose([order("a"), order("b", window_close_time="06:30")], [veh("T1")], DTRAVEL, ALLOW, params, monsoon=False)
    served = [a for a in assignments if a["decision"] == "served"]
    assert len(served) == 2 and len(trips) == 1
    assert sorted(a["stop_seq"] for a in served) == [1, 2]
    assert next(a for a in served if a["stop_seq"] == 1)["order_ref"] == "b"  # earliest-closing window first
    assert all(0 <= a["pred_late_prob"] <= 1 and a["pred_window"] for a in served)


DATA = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
CHECKER = Path(os.environ.get("CHECKER", DATA.resolve().parent.parent / "check_allocation.py"))


@pytest.mark.skipif(not (DATA / "Test Data/task2b_peak_day_scenarios.csv").exists() or not CHECKER.exists(), reason="needs the datasets and check_allocation.py")
def test_peak_day_allocation_passes_the_organisers_checker():
    import pandas as pd

    s1 = pd.read_csv(DATA / "Test Data/task2b_peak_day_scenarios.csv")
    fleet = pd.read_csv(DATA / "Test Data/task2b_peak_day_fleet.csv")
    vehicles = pd.read_csv(DATA / "General Data/vehicles.csv")
    dtravel = pd.read_csv(DATA / "General Data/district_travel.csv").set_index("district").to_dict("index")
    allow = {(r.brand, r.dock_type): r.service_allowance_min for r in pd.read_csv(DATA / "General Data/service_allowance.csv").itertuples()}
    status = dict(zip(fleet.vehicle_id, fleet.status))
    veh = [dict(v, status=status.get(v["vehicle_id"], "available"), fuel_used_l=0) for v in vehicles.to_dict("records")]
    orders = s1.fillna({"mall_window": ""}).to_dict("records")
    available = {v["vehicle_id"] for v in veh if status.get(v["vehicle_id"]) == "available"}
    result, _ = allocate(orders, veh, available, dtravel, allow, {v["vehicle_id"]: v["weekly_fuel_quota_l"] for v in veh})

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "submission_task2b.csv"
        with out.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["scenario", "order_ref", "outlet_id", "decision", "vehicle_id", "trip_id"])
            for o in orders:
                r = result[o["order_ref"]]
                w.writerow(["S1", o["order_ref"], o["outlet_id"], r["decision"], r.get("vehicle_id", ""), r.get("trip_id", "")])
        p = subprocess.run([sys.executable, str(CHECKER), str(out)], capture_output=True, text=True, cwd=CHECKER.parent)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "PASSED" in p.stdout
