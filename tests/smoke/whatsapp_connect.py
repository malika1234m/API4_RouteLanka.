"""A store connects its own WhatsApp number: API + Cloud API simulator, standard library only.

    python tests/smoke/whatsapp_connect.py         # API at http://localhost:4000, simulator at http://localhost:3200
    API=http://host:4000 SIM=http://host:3200 python tests/smoke/whatsapp_connect.py

The store asks for a code in the app, then sends "JOIN <outlet> <code>" from a phone (here, the simulator's
phone, through the signed webhook). Covers: a wrong code is refused, the right one links that phone and a
confirmation reaches it on WhatsApp, a used code can't be reused, one phone can't serve two stores, another
district's area manager is refused, STOP from the phone and Disconnect in the app both turn it off. At the end
the outlet's demo number is connected again.
"""
import http.cookiejar
import json
import os
import random
import time
import urllib.error
import urllib.request

API = os.environ.get("API", "http://localhost:4000") + "/api"
SIM = os.environ.get("SIM", "http://localhost:3200") + "/wa-sim/api"
PW = os.environ.get("SEED_PASSWORD", "routelanka")
OUTLET, OTHER = "OUT050", "OUT051"
step = lambda s: print("  ok ", s)
fmt = lambda n: f"+{n[:2]} {n[2:4]} {n[4:7]} {n[7:]}"


class Session:
    def __init__(self):
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, url, body=None, role=None):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
        req.add_header("content-type", "application/json")
        if role:
            req.add_header("x-rl-role", role)
        try:
            r = self.http.open(req)
            return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def ok(self, url, body=None, role=None):
        status, out = self.call(url, body, role)
        assert status == 200, f"{url} {body}: HTTP {status} {out}"
        return out


def phone_says(sim, number, text):
    """The store types a message on its phone; the simulator posts the signed webhook to the API."""
    sim.ok(f"{SIM}/text", {"phone": number, "text": text})


def wait(fn, what, tries=40):
    for _ in range(tries):
        out = fn()
        if out:
            return out
        time.sleep(0.25)
    raise AssertionError(f"timed out waiting for {what}")


store, sim = Session(), Session()
store.ok(f"{API}/day/new", {})
store.ok(f"{API}/auth/login", {"username": "malika.out029", "password": PW})
conn = lambda o=OUTLET: store.ok(f"{API}/whatsapp/connection?outlet={o}", role="store")
demo = "94770000" + OUTLET[3:]

# Start from the demo number, whatever an earlier run left.
if (conn()["connected"] or {}).get("phone") != fmt(demo):
    store.ok(f"{API}/whatsapp/disconnect", {"outlet": OUTLET}, "store")
    phone_says(sim, demo, store.ok(f"{API}/whatsapp/connect", {"outlet": OUTLET}, "store")["pending"]["text"])
    wait(lambda: (conn()["connected"] or {}).get("phone") == fmt(demo), "demo number")
c = conn()
assert c["connected"]["phone"] == fmt(demo) and not c["pending"], c
step(f"{OUTLET} starts on its demo number {fmt(demo)}")

# ── Ask for a code ──
c = store.ok(f"{API}/whatsapp/connect", {"outlet": OUTLET}, "store")
text = c["pending"]["text"]
code = text.split()[-1]
assert text == f"JOIN {OUTLET} {code}" and len(code) == 6, c["pending"]
assert c["pending"]["link"].startswith("https://wa.me/") and "JOIN" in c["pending"]["link"].replace("%20", " "), c["pending"]
assert c["pending"]["simulator"].startswith("/wa-sim/?text="), c["pending"]
step(f"code issued: \"{text}\", with a wa.me link and a simulator link")

mine = "9477" + str(random.randint(1000000, 9999999))
wrong = f"{int(code) + 1:06d}"[-6:]
phone_says(sim, mine, f"JOIN {OUTLET} {wrong}")
time.sleep(1)
c = conn()
assert c["connected"]["phone"] == fmt(demo) and c["pending"], f"a wrong code must not connect: {c}"
step("a wrong code is refused; the code stays open")

phone_says(sim, mine, text)
c = wait(lambda: (lambda x: x if (x["connected"] or {}).get("phone") == fmt(mine) else None)(conn()), "the new number")
assert c["connected"]["source"] == "join" and c["connected"]["by"] == "Malika" and not c["pending"], c
state = wait(lambda: (lambda s: s if any("WhatsApp connected" in m["text"] for p in s["phones"] if p["number"] == mine for m in p["messages"] if m["from"] == "business") else None)(sim.ok(f"{SIM.replace('/api', '/api/state')}")), "the confirmation on the phone")
step(f"JOIN from {fmt(mine)} connected it; the confirmation arrived on that phone on WhatsApp")

msgs = store.ok(f"{API}/messages?outlet={OUTLET}", role="store")
assert any("WhatsApp connected" in m["template"] for m in msgs), "the confirmation shows in the app's thread too"

# A used code is gone; one phone can't serve two stores.
phone_says(sim, "9477" + str(random.randint(1000000, 9999999)), text)
time.sleep(1)
assert conn()["connected"]["phone"] == fmt(mine), "a used code can't connect another phone"
other_text = store.ok(f"{API}/whatsapp/connect", {"outlet": OTHER}, "store")["pending"]["text"]
phone_says(sim, mine, other_text)
time.sleep(1)
assert (conn(OTHER)["connected"] or {}).get("phone") != fmt(mine), "one phone serves one store"
step("a used code can't be reused; a phone already serving a store can't join another")

# Another district's area manager can't see or change this store's WhatsApp.
district = next(o["district"] for o in store.ok(f"{API}/reference")["outlets"] if o["outlet_id"] == OUTLET)
away = next(d for d in ["Kandy", "Colombo"] if d != district)
outsider = Session()
outsider.ok(f"{API}/auth/login", {"username": away.lower() + ".area", "password": PW})
assert outsider.call(f"{API}/whatsapp/connection?outlet={OUTLET}", role="store")[0] == 403
assert outsider.call(f"{API}/whatsapp/connect", {"outlet": OUTLET}, "store")[0] == 403
step(f"{away}'s area manager is refused for {OUTLET} ({district})")

# STOP from the phone turns it off.
phone_says(sim, mine, "STOP")
wait(lambda: conn()["connected"] is None, "STOP")
assert any("STOP" in m["template"] for m in store.ok(f"{API}/messages?outlet={OUTLET}", role="store")), "the app says why"
step("STOP from the phone disconnected it; the app thread says so")

# Connect the demo number again, then Disconnect in the app, then restore.
phone_says(sim, demo, store.ok(f"{API}/whatsapp/connect", {"outlet": OUTLET}, "store")["pending"]["text"])
wait(lambda: (conn()["connected"] or {}).get("phone") == fmt(demo), "the demo number again")
assert store.ok(f"{API}/whatsapp/disconnect", {"outlet": OUTLET}, "store")["connected"] is None
phone_says(sim, demo, store.ok(f"{API}/whatsapp/connect", {"outlet": OUTLET}, "store")["pending"]["text"])
wait(lambda: (conn()["connected"] or {}).get("phone") == fmt(demo), "the demo number restored")
step("Disconnect in the app works; the demo number is connected again")
print("PASS")
