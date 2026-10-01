"""API smoke test: one whole night through the HTTP API, across all four roles, with asserts.

Runs against a live stack (`docker compose up`), standard library only:
    python tests/smoke/api_flow.py                 # API at http://localhost:4000
    API=http://host:4000 python tests/smoke/api_flow.py

It starts a fresh demo day, so it never disturbs another day in use. Covers: role checks, publish, the
loader's flag and the dispatcher's decision, rule enforcement (a trip can't be ready before it is
loaded), handover-code secrecy, an offline delivery synced later (and synced twice: idempotent), a
driver SMS delay report, the dispatcher's delay plan, a store reply and store receipt, and the planning
engine round trip over RabbitMQ.
"""
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.request
import uuid

B = os.environ.get("API", "http://localhost:4000") + "/api"
SMS_TOKEN = os.environ.get("SMS_GATEWAY_TOKEN", "dev-sms-token")
jar = http.cookiejar.CookieJar()
http_ = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(path, body=None, role=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
    req.add_header("content-type", "application/json")
    if role:
        req.add_header("x-rl-role", role)
    try:
        return 200, json.loads(http_.open(req).read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def ok(path, body=None, role=None):
    status, out = call(path, body, role)
    assert status == 200, f"{path} {body and body.get('type')}: HTTP {status} {out}"
    return out


cmd = lambda role, **c: ok("/commands", c, role)
step = lambda s: print("  ok ", s)

ok("/day/new", {})
anon = ok("/view", role="store")
assert not anon.get("codes") and not anon.get("codeHashes"), "no secrets without a signed-in account"
status, _ = call("/commands", {"type": "publish"}, "dispatcher")
assert status == 401, "commands need a signed-in account"
for u in ["gehiru.dispatch", "senash.kandydock", "nimsith.veh041", "malika.out029"]:
    ok("/auth/login", {"username": u, "password": os.environ.get("SEED_PASSWORD", "routelanka")})
step("fresh day, four accounts signed in")

status, _ = call("/commands", {"type": "publish"}, "driver")
assert status == 403, "a driver must not be able to publish the plan"
step("role guard: driver cannot publish")

# The planning engine over RabbitMQ: the API queues a job, the Python worker proposes a plan.
cmd("dispatcher", type="proposePlan")
for _ in range(60):
    job = ok("/view", role="dispatcher").get("planJob") or {}
    if job.get("status") in ("done", "failed"):
        break
    time.sleep(0.5)
assert job.get("status") == "done", f"planning job did not finish: {job}"
step(f"engine proposed a plan via RabbitMQ: {job['summary']}")

cmd("dispatcher", type="publish")
v = ok("/view", role="dispatcher")
assert v["published"]
drv = v["driver"]
key = f"{drv['vehicle_id']}#{drv['trip_id']}"
run = sorted([o for o in v["orders"] if o.get("vehicle_id") == drv["vehicle_id"] and o.get("trip_id") == drv["trip_id"]], key=lambda o: o["stop_seq"])
assert run, "the driver's trip has stops"
step(f"plan published; driver run {key} has {len(run)} stops")

# Guards: a shortfall decision needs a flag; an unknown trip can't be marked ready.
status, out = call("/commands", {"type": "shortfallDecision", "ref": run[0]["order_ref"], "decision": "send_short"}, "dispatcher")
assert status == 409, f"decision without a flag must be refused: {status} {out}"
status, _ = call("/commands", {"type": "ready", "key": "VEH999#1"}, "loader")
assert status == 404, "ready on a trip that isn't planned must be refused"
step("guards: no shortfall decision without a flag, no ready for an unknown trip")

# Change after publishing: defer one order and publish the change. Only that store is told.
changed = next(o for o in v["orders"] if o["decision"] == "served" and o not in run)
before_msgs = {m["id"] for m in ok(f"/messages?outlet={changed['outlet_id']}", role="store")}
cmd("dispatcher", type="defer", ref=changed["order_ref"], reason="dispatcher_choice")
cmd("dispatcher", type="publish")
for _ in range(30):
    new = [m for m in ok(f"/messages?outlet={changed['outlet_id']}", role="store") if m["id"] not in before_msgs]
    if new:
        break
    time.sleep(0.3)
assert any("not coming" in m["template"] for m in new), f"store not told about the change: {new}"
step(f"published change: {changed['outlet_id']} deferred after publishing, and its store was told")

flagged = run[-1]
cmd("loader", type="loadFlag", ref=flagged["order_ref"], issue={"kind": "missing", "qty": 2})
status, _ = call("/commands", {"type": "ready", "key": key}, "loader")
assert status != 200, "a trip cannot be marked ready before every order is loaded"
cmd("dispatcher", type="shortfallDecision", ref=flagged["order_ref"], decision="send_short")
for o in run:
    cmd("loader", type="loadTick", ref=o["order_ref"])
cmd("loader", type="ready", key=key)
cmd("loader", type="depart", key=key)
step("loader flagged a shortfall, dispatcher decided, trip loaded and departed")

# Once a truck has left, its stops can't be re-planned from the board, and nothing can join it.
status, out = call("/commands", {"type": "defer", "ref": run[0]["order_ref"], "reason": "dispatcher_choice"}, "dispatcher")
assert status == 409, f"deferring a stop that left the depot must be refused: {status} {out}"
spare = next(o for o in v["orders"] if o["depot"] == run[0]["depot"] and o not in run)
status, _ = call("/commands", {"type": "move", "ref": spare["order_ref"], "vehicle_id": drv["vehicle_id"], "trip_id": drv["trip_id"]}, "dispatcher")
assert status == 409, "nothing can be added to a trip that has left"
# A stop handed over on the road must go to a vehicle that can carry it.
chilled = next((o for o in run if o["temp_requirement"] == "chilled"), None)
if chilled:
    ambient = next(x["vehicle_id"] for x in v["vehicles"] if x["temp"] == "ambient" and x["depot"] == chilled["depot"] and x["status"] == "available")
    status, out = call("/commands", {"type": "reassign", "ref": chilled["order_ref"], "to": ambient}, "dispatcher")
    assert status == 409 and "refrigerated" in out.get("error", ""), f"chilled stop to an ambient truck must be refused: {status} {out}"
step("guards: departed stops locked on the board; on-road handovers need a suitable vehicle")

first = run[0]
store = ok("/view", role="store")
code = store["codes"][first["order_ref"]]
dv = ok("/view", role="driver")
assert "codes" not in dv and first["order_ref"] in dv["codeHashes"], "the driver gets hashes, never the codes"
step("handover code visible to the store only; the driver holds a hash")

cmd("driver", type="setOnline", online=False)
events = [
    {"id": str(uuid.uuid4()), "order_ref": first["order_ref"], "type": "arrived", "at": "05:48"},
    {"id": str(uuid.uuid4()), "order_ref": first["order_ref"], "type": "delivered", "at": "05:50",
     "payload": {"deliveredUnits": first["order_units"], "pod": {"name": "staff", "method": "code", "code": code}}},
]
sms = f"RL DELAY {drv['vehicle_id']} road_blocked 60 | near the next stop | DONE {first['order_ref']}@05:50"
ok("/sms/inbound", {"token": SMS_TOKEN, "body": sms})
assert ok("/view", role="dispatcher")["driver"].get("delay"), "the SMS delay report reached the dispatcher"
step("driver offline; delay report arrived by SMS")

remaining = run[1:]
if remaining:
    cmd("dispatcher", type="planDelay", plan={o["order_ref"]: "late" for o in remaining}, summary="smoke test: all stops run late")
    cmd("store", type="storeReply", ref=remaining[0]["order_ref"], reply="wait")
    step("dispatcher planned the delay; a store replied")

r1 = ok("/sync", {"offline": True, "events": events}, "driver")
r2 = ok("/sync", {"offline": True, "events": events}, "driver")
st = ok("/view", role="driver")["states"][first["order_ref"]]
assert st["stage"] == "delivered" and st.get("recordedOffline") and st.get("deliveredAt") == "05:50", st
assert st.get("pod", {}).get("verified"), "the server re-checked the handover code"
step(f"offline records synced (first {r1}, again {r2}); kept their recorded time; code verified")

cmd("store", type="receive", ref=first["order_ref"], ok=True)

# Store order: before the 16:00 cutoff it goes on the next operating day's run.
placed = cmd("store", type="placeOrder", lines=[{"temp": "chilled", "units": 4, "volume_m3": 0.2, "weight_kg": 30}])
assert placed["run_date"] and not placed["afterCutoff"], placed
step(f"store order {placed['refs'][0]} confirmed for the {placed['run_date']} run (before the 16:00 cutoff)")
feed = ok("/view", role="dispatcher")["feed"]
assert len(feed) > 5
step(f"store confirmed receipt; {len(feed)} events in the shared feed")
print("PASS")
