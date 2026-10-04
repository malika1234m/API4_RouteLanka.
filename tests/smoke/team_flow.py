"""API smoke test for staff accounts: the dispatcher's Team screen, and new people working their own scope.

Runs against a live stack, standard library only:
    python tests/smoke/team_flow.py                # API at http://localhost:4000
    API=http://host:4000 python tests/smoke/team_flow.py

Each person has their own browser session, as in real use. Covers: only dispatchers manage accounts;
validation (usernames, one driver per vehicle, demo accounts kept); a new driver sees and delivers
their own vehicle's run, reports a delay by SMS and gets the dispatcher's decision, while the demo run is
untouched; a new store manager sees only their own store's codes, messages and orders; deactivating an
account signs it out at once; a district's area manager covers that district's stores only. The accounts it creates are deactivated at the end, so it can run again.
"""
import http.cookiejar
import json
import os
import secrets
import urllib.error
import urllib.request
import uuid

B = os.environ.get("API", "http://localhost:4000") + "/api"
SMS_TOKEN = os.environ.get("SMS_GATEWAY_TOKEN", "dev-sms-token")
PW = os.environ.get("SEED_PASSWORD", "routelanka")
step = lambda s: print("  ok ", s)


class Session:
    """One person's browser: its own cookies (sign-in and demo day)."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, path, body=None, role=None):
        req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
        req.add_header("content-type", "application/json")
        if role:
            req.add_header("x-rl-role", role)
        try:
            r = self.http.open(req)
            return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def ok(self, path, body=None, role=None):
        status, out = self.call(path, body, role)
        assert status in (200, 201), f"{path} {body}: HTTP {status} {out}"
        return out

    def same_day_as(self, other):
        for c in other.jar:
            if c.name == "rl_day":
                self.jar.set_cookie(c)


boss = Session()
boss.ok("/day/new", {})
boss.ok("/auth/login", {"username": "gehiru.dispatch", "password": PW})
boss.ok("/auth/login", {"username": "senash.kandydock", "password": PW})
boss.ok("/commands", {"type": "publish"}, "dispatcher")
v = boss.ok("/view", role="dispatcher")
demo = v["driver"]
assert demo["vehicle_id"] == "VEH041", demo

# ── Who may manage accounts ──
status, _ = boss.call("/team", role="loader")
assert status == 403, "only dispatchers manage accounts"
team = boss.ok("/team", role="dispatcher")["people"]
assert {p["username"] for p in team if p["demo"]} >= {"gehiru.dispatch", "senash.kandydock", "nimsith.veh041", "malika.out029"}
step(f"Team lists {len(team)} accounts; a loader is refused")

# A vehicle with a planned run, other than the demo driver's and without a driver's phone yet.
taken = {p["vehicle_id"] for p in team if p["role"] == "driver" and p["active"]}
runs = {}
for o in v["orders"]:
    if o["decision"] == "served" and o["vehicle_id"] not in taken and o["vehicle_id"] != demo["vehicle_id"]:
        runs.setdefault((o["vehicle_id"], o["trip_id"]), []).append(o)
(vid, trip), run = max(runs.items(), key=lambda kv: (len(kv[1]), -kv[0][1]))
run.sort(key=lambda o: o["stop_seq"])
# The driver's current trip is the vehicle's first open one; use that trip if it is not the one picked.
trip = min(t for (x, t) in runs if x == vid)
run = sorted(runs[(vid, trip)], key=lambda o: o["stop_seq"])
assert len(run) >= 2, f"want a run with at least two stops, got {vid}#{trip}"
outlet = run[0]["outlet_id"]
other_outlet = next(o["outlet_id"] for o in v["orders"] if o["outlet_id"] != outlet and o["decision"] == "served")

tag = secrets.token_hex(2)
driver_u, store_u = f"test.driver{tag}", f"test.store{tag}"
temp_pw = "temp-" + secrets.token_hex(4)

# ── Validation ──
status, out = boss.call("/team", {"role": "driver", "name": "X", "username": "a b", "password": temp_pw, "vehicle_id": vid}, "dispatcher")
assert status == 400, f"bad username must be refused: {status} {out}"
status, out = boss.call("/team", {"role": "driver", "name": "X", "username": f"x{tag}", "password": "short", "vehicle_id": vid}, "dispatcher")
assert status == 400, f"short password must be refused: {status} {out}"
status, out = boss.call("/team", {"role": "driver", "name": "X", "username": f"x{tag}", "password": temp_pw, "vehicle_id": "VEH041"}, "dispatcher")
assert status == 409 and "already has a driver" in out["error"], f"one driver per vehicle: {status} {out}"
status, out = boss.call("/team", {"role": "store", "name": "X", "username": f"x{tag}", "password": temp_pw}, "dispatcher")
assert status == 400, f"a store manager needs a store: {status} {out}"
status, out = boss.call("/team", {"role": "loader", "name": "X", "username": "gehiru.dispatch", "password": temp_pw, "depot": "Kandy"}, "dispatcher")
assert status == 409 and "taken" in out["error"], f"duplicate username: {status} {out}"
demo_id = next(p["id"] for p in team if p["username"] == "nimsith.veh041")
status, out = boss.call(f"/team/{demo_id}", {"active": False}, "dispatcher")
assert status == 409, f"demo accounts are kept: {status} {out}"
step("validation: username, password, one driver per vehicle, store required, duplicates, demo accounts kept")

# ── Add a driver and a store manager ──
r = boss.ok("/team", {"role": "driver", "name": "Kasun Perera", "username": driver_u.upper(), "password": temp_pw, "vehicle_id": vid}, "dispatcher")
driver_id = r["id"]
added = next(p for p in r["people"] if p["id"] == driver_id)
assert added["username"] == driver_u and added["vehicle_id"] == vid and added["created_by"] == "Gehiru", added
store_id = boss.ok("/team", {"role": "store", "name": "Dilani Silva", "username": store_u, "password": temp_pw, "outlet_id": outlet}, "dispatcher")["id"]
step(f"added driver {driver_u} on {vid} and store manager {store_u} for {outlet}")

# ── The new driver works their own run ──
kasun = Session()
kasun.same_day_as(boss)
kasun.ok("/auth/login", {"username": driver_u, "password": temp_pw})
dv = kasun.ok("/view", role="driver")
assert dv["driver"]["vehicle_id"] == vid and dv["driver"]["trip_id"] == trip and dv["driver"].get("name") == "Kasun Perera", dv["driver"]
assert dv["me"]["driver"]["vehicle_id"] == vid
assert set(dv["codeHashes"]) == {o["order_ref"] for o in run}, "the driver holds hashes for their own stops only"
assert any(r["vehicle_id"] == vid for r in dv["drivers"]) and any(r["vehicle_id"] == "VEH041" for r in dv["drivers"])
step(f"new driver opens on {vid} trip {trip}: {len(run)} stops, hashes for those stops only")

key = f"{vid}#{trip}"
for o in run:
    boss.ok("/commands", {"type": "loadTick", "ref": o["order_ref"]}, "loader")
boss.ok("/commands", {"type": "ready", "key": key}, "loader")
boss.ok("/commands", {"type": "depart", "key": key}, "loader")

# Offline: the delay goes by SMS from this vehicle; a delivery waits on the phone.
kasun.ok("/commands", {"type": "setOnline", "online": False}, "driver")
dana = Session()
dana.same_day_as(boss)
dana.ok("/auth/login", {"username": store_u, "password": temp_pw})
first = run[0]
code = dana.ok("/view", role="store")["codes"][first["order_ref"]]
sms = f"RL DELAY {vid} slow_traffic 40 | near {run[1]['outlet_id']} | DONE {first['order_ref']}@05:31"
kasun.ok("/sms/simulate", {"body": sms}, "driver")
bv = boss.ok("/view", role="dispatcher")
mine = next(r for r in bv["drivers"] if r["vehicle_id"] == vid)
demo_run = next(r for r in bv["drivers"] if r["vehicle_id"] == "VEH041")
assert not mine["online"] and mine["delay"]["minutes"] == 40 and mine["delay"]["via"] == "sms", mine
assert demo_run["online"] and not demo_run.get("delay"), f"the demo run is untouched: {demo_run}"
assert any(f["text"].startswith(f"SMS from {vid}:") for f in bv["feed"]), "the dispatcher sees the SMS in the feed"
status, out = boss.call("/sms/inbound", {"token": SMS_TOKEN, "body": "RL DELAY VEH999 road_blocked 30 | nowhere"})
assert status == 400, "an SMS from a vehicle without a driver's phone is refused"
step(f"{vid} offline; its SMS delay reached the dispatcher; VEH041 untouched; unknown vehicles refused")

boss.ok("/commands", {"type": "planDelay", "vehicle_id": vid, "plan": {o["order_ref"]: "late" for o in run[1:]}, "summary": f"{vid} delay plan (team test)"}, "dispatcher")
mine = next(r for r in boss.ok("/view", role="dispatcher")["drivers"] if r["vehicle_id"] == vid)
assert mine["delay"].get("toldAt"), "the decision is recorded on this vehicle's run"
status, out = boss.call("/commands", {"type": "planDelay", "vehicle_id": vid, "plan": {next(o for o in v["orders"] if o["vehicle_id"] == "VEH041")["order_ref"]: "late"}, "summary": "x"}, "dispatcher")
assert status == 400, f"a delay plan only covers that vehicle's stops: {status} {out}"
step("dispatcher decided the delay for this vehicle; stops on other runs refused")

events = [
    {"id": str(uuid.uuid4()), "order_ref": first["order_ref"], "type": "arrived", "at": "05:29"},
    {"id": str(uuid.uuid4()), "order_ref": first["order_ref"], "type": "delivered", "at": "05:31",
     "payload": {"deliveredUnits": first["order_units"], "pod": {"name": "Dilani", "method": "code", "code": code}}},
]
synced = kasun.ok("/sync", {"offline": True, "events": events}, "driver")
assert synced["accepted"] == 2, synced
st = kasun.ok("/view", role="driver")["states"][first["order_ref"]]
assert st["stage"] == "delivered" and st.get("recordedOffline") and st["pod"].get("verified"), st
assert next(r for r in kasun.ok("/view", role="driver")["drivers"] if r["vehicle_id"] == vid)["online"], "back online after the sync"
foreign = next(o for o in v["orders"] if o["vehicle_id"] == "VEH041")
status, out = kasun.call("/sync", {"offline": False, "events": [{"id": str(uuid.uuid4()), "order_ref": foreign["order_ref"], "type": "arrived", "at": "05:40"}]}, "driver")
assert status == 400, f"a driver can't record stops on another vehicle's run: {status} {out}"
step("offline delivery synced with its recorded time and a verified code; other runs' stops refused")

# ── The new store manager sees only their own store ──
sv = dana.ok("/view", role="store")
assert sv["codes"] and all(next(o for o in sv["orders"] if o["order_ref"] == r)["outlet_id"] == outlet for r in sv["codes"]), "codes for their store only"
assert sv["me"]["store"]["outlet_id"] == outlet and not sv["me"]["store"].get("demo")
status, _ = dana.call(f"/messages?outlet={other_outlet}", role="store")
assert status == 403, "another store's messages are refused"
dana.ok(f"/messages?outlet={outlet}", role="store")
dana.ok("/commands", {"type": "receive", "ref": first["order_ref"], "ok": True}, "store")
theirs = next(o for o in v["orders"] if o["outlet_id"] == other_outlet)
status, _ = dana.call("/commands", {"type": "receive", "ref": theirs["order_ref"], "ok": True}, "store")
assert status == 403, "another store's order is refused"
status, _ = dana.call("/commands", {"type": "placeOrder", "outlet_id": other_outlet, "lines": [{"temp": "ambient", "units": 1, "volume_m3": 0.1, "weight_kg": 5}]}, "store")
assert status == 403, "ordering for another store is refused"
step(f"store manager: codes, messages and orders for {outlet} only; confirmed receipt of {first['outlet_id']}")

# ── An area manager covers every store in their district, and only those ──
district = run[0]["district"]
area_u = district.lower().replace(" ", "") + ".area"
area = Session()
area.same_day_as(boss)
area.ok("/auth/login", {"username": area_u, "password": PW})
av = area.ok("/view", role="store")
assert av["me"]["store"]["district"] == district, av["me"]
in_district = {o["order_ref"] for o in av["orders"] if o["district"] == district}
assert av["codes"] and set(av["codes"]) <= in_district, "codes for their district's stores only"
outside = next(o for o in v["orders"] if o["district"] != district)
area.ok(f"/messages?outlet={outlet}", role="store")
status, _ = area.call(f"/messages?outlet={outside['outlet_id']}", role="store")
assert status == 403, "another district's messages are refused"
status, _ = area.call("/commands", {"type": "placeOrder", "outlet_id": outside["outlet_id"], "lines": [{"temp": "ambient", "units": 1, "volume_m3": 0.1, "weight_kg": 5}]}, "store")
assert status == 403, "ordering for another district's store is refused"
step(f"area manager {area_u}: codes and messages for {district}'s stores; other districts refused")

# A dispatcher can add an area manager too.
status, out = boss.call("/team", {"role": "store", "name": "X", "username": f"x{tag}", "password": temp_pw, "district": "Atlantis"}, "dispatcher")
assert status == 400, f"an unknown district is refused: {status} {out}"
new_area = boss.ok("/team", {"role": "store", "name": "Test Area", "username": f"test.area{tag}", "password": temp_pw, "district": district}, "dispatcher")
assert next(p for p in new_area["people"] if p["id"] == new_area["id"])["district"] == district
boss.ok(f"/team/{new_area['id']}", {"active": False}, "dispatcher")

# ── Edit, reset, deactivate ──
lead_u = f"test.lead{tag}"
lead_id = boss.ok("/team", {"role": "dispatcher", "name": "Test Lead", "username": lead_u, "password": temp_pw, "depot": "Kandy"}, "dispatcher")["id"]
lead = Session()
lead.ok("/auth/login", {"username": lead_u, "password": temp_pw})
status, out = lead.call(f"/team/{lead_id}", {"active": False}, "dispatcher")
assert status == 409 and "own account" in out["error"], f"a dispatcher can't deactivate themselves: {status} {out}"
boss.ok(f"/team/{lead_id}", {"active": False}, "dispatcher")
boss.ok(f"/team/{driver_id}", {"name": "Kasun P.", "password": "new-" + temp_pw}, "dispatcher")
status, _ = Session().call("/auth/login", {"username": driver_u, "password": temp_pw})
assert status == 401, "the old password stops working after a reset"
boss.ok(f"/team/{driver_id}", {"active": False}, "dispatcher")
status, _ = kasun.call("/commands", {"type": "setOnline", "online": False}, "driver")
assert status in (401, 403), f"a deactivated account is signed out at once: {status}"
status, out = Session().call("/auth/login", {"username": driver_u, "password": "new-" + temp_pw})
assert status == 403 and "deactivated" in out["error"], f"a deactivated account can't sign in: {status} {out}"
boss.ok(f"/team/{store_id}", {"active": False}, "dispatcher")
assert not any(r["vehicle_id"] == vid for r in boss.ok("/view", role="dispatcher")["drivers"]), "its vehicle no longer has a tracked phone"
step("no self-deactivation; rename and password reset; deactivated accounts signed out and refused; test accounts deactivated")
print("PASS")
