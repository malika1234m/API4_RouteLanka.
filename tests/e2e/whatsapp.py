"""WhatsApp integration, end to end over the real wire (Cloud API simulator in place of Meta).

Checks, in order:
  1. publishing sends the store's messages as approved templates (outside the 24-hour window), and the
     simulator's signed status webhooks move them to delivered;
  2. a tap on "Noted, thanks" on the store's phone comes back as a signed webhook and acknowledges the deferral;
  3. inside the 24-hour window that opens, the next message goes free-form instead of as a template;
  4. free text gets the "use the buttons" answer; opening the chat sends read receipts;
  5. the store's language follows to WhatsApp (Sinhala text on the phone);
  6. security: a forged signature is rejected (401), a replayed webhook is applied once, and a store can't act
     on another store's order even with a validly signed webhook.

    API=http://localhost:4000 SIM=http://localhost:3200 python tests/e2e/whatsapp.py
"""
import hashlib
import hmac
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.request
import uuid

API = os.environ.get("API", "http://localhost:4000") + "/api"
SIM = os.environ.get("SIM", "http://localhost:3200") + "/wa-sim/api"
SECRET = os.environ.get("WHATSAPP_APP_SECRET", "dev-wa-app-secret")
STORE = "94770000029"  # OUT029, the walkthrough's store
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def req(url, body=None, role=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET")
    r.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    if role:
        r.add_header("x-rl-role", role)
    try:
        resp = opener.open(r)
        return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def ok(url, body=None, role=None):
    s, out = req(url, body, role)
    assert s == 200, f"{url}: HTTP {s} {out}"
    return out


def wait(what, fn, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.3)
    raise AssertionError(f"timed out waiting for: {what}")


def phone(n=STORE):
    return next((p for p in ok(f"{SIM}/state")["phones"] if p["number"] == n), {"messages": []})


def step(s):
    print("  ok ", s)


ok(f"{API}/day/new", {})
for u in ["gehiru.dispatch", "malika.out029"]:
    ok(f"{API}/auth/login", {"username": u, "password": "routelanka"})
ok(f"{API}/commands", {"type": "setLang", "role": "store", "lang": "en"}, "store")
contact = next(c for c in ok(f"{API}/whatsapp/console", role="dispatcher")["contacts"] if c["outlet_id"] == "OUT029")
window_open = bool(contact["last_inbound_at"]) and time.time() - __import__("datetime").datetime.fromisoformat(contact["last_inbound_at"].replace("Z", "+00:00")).timestamp() < 24 * 3600
expected = "interactive" if window_open else "template"
before = len(phone()["messages"])
ok(f"{API}/commands", {"type": "publish"}, "dispatcher")

# 1. Templates out, statuses back.
new = wait("OUT029's messages on its phone", lambda: [m for m in phone()["messages"][before:] if m["from"] == "business"] or None)
deferral = wait("the deferral notice with its Noted button", lambda: next((m for m in phone()["messages"][before:] if m["buttons"] and m["buttons"][0]["title"] == "Noted, thanks"), None))
assert deferral["kind"] == expected, (expected, deferral)
if expected == "template":
    assert deferral["template"] == "routelanka_update_ack", deferral
assert all(m["kind"] in (expected, "text") for m in new), [m["kind"] for m in new]
console = wait("delivered in RouteLanka", lambda: (c := ok(f"{API}/whatsapp/console", role="dispatcher"))["stats"].get("delivered") and c)
assert any(r["direction"] == "outbound" and r["http_status"] == 200 for r in console["log"])
# Every webhook the API accepted was validly signed (rejected forgeries are listed too, with 401).
assert all(r["signature_ok"] for r in console["log"] if r["direction"] == "webhook" and r["http_status"] == 200)
step(f"{len(new)} messages to OUT029 sent {'free-form (24-hour window open from an earlier reply)' if window_open else 'as approved templates (no reply in 24 h)'}; signed status webhooks marked them delivered")

# 2. A tap comes back and acknowledges the deferral.
ref = next(o["order_ref"] for o in ok(f"{API}/view", role="dispatcher")["orders"] if o["outlet_id"] == "OUT029" and o["decision"] == "deferred")
ok(f"{SIM}/tap", {"phone": STORE, "messageId": deferral["id"], "button": 0})
wait("the acknowledgement in the dispatcher's view", lambda: ref in ok(f"{API}/view", role="dispatcher")["acks"])
feed = ok(f"{API}/view", role="dispatcher")["feed"]
assert any("acknowledged the deferral on WhatsApp" in f["text"] for f in feed), [f["text"] for f in feed[:5]]
step(f"tap on 'Noted, thanks' on the phone -> signed webhook -> {ref} acknowledged; the dispatcher's feed shows it")

# 3. Inside the window: free-form.
n = len(phone()["messages"])
ok(f"{API}/commands", {"type": "placeOrder", "lines": [{"temp": "ambient", "units": 6, "volume_m3": 0.3, "weight_kg": 40}]}, "store")
receipt = wait("the order receipt on the phone", lambda: next((m for m in phone()["messages"][n:] if m["from"] == "business"), None))
assert receipt["kind"] in ("text", "interactive"), receipt
step(f"inside the 24-hour window the next message went free-form ({receipt['kind']}), not as a template")

# 4. Free text and read receipts.
n = len(phone()["messages"])
ok(f"{SIM}/text", {"phone": STORE, "text": "is my dairy coming?"})
wait("the 'use the buttons' answer", lambda: any("use the buttons" in m["text"] for m in phone()["messages"][n:]))
ok(f"{SIM}/read", {"phone": STORE})
wait("read receipts in RouteLanka", lambda: ok(f"{API}/whatsapp/console", role="dispatcher")["stats"].get("read"))
step("free text answered with 'use the buttons'; opening the chat sent read receipts back")

# 5. Language follows the store to WhatsApp.
ok(f"{API}/commands", {"type": "setLang", "role": "store", "lang": "si"}, "store")
n = len(phone()["messages"])
ok(f"{API}/commands", {"type": "placeOrder", "lines": [{"temp": "ambient", "units": 3, "volume_m3": 0.2, "weight_kg": 20}]}, "store")
si = wait("a Sinhala message", lambda: next((m for m in phone()["messages"][n:] if m["from"] == "business"), None))
assert any("඀" <= ch <= "෿" for ch in si["text"]), si["text"]
ok(f"{API}/commands", {"type": "setLang", "role": "store", "lang": "en"}, "store")
step("the store switched to Sinhala and its next WhatsApp message arrived in Sinhala")

# 6. Security.
s, out = req(f"{SIM}/forged", {})
assert out.get("http") == 401, out
assert any(r["signature_ok"] is False for r in ok(f"{API}/whatsapp/console", role="dispatcher")["log"])
s, out = req(f"{SIM}/replay", {})
assert out.get("http") == 200, out
step("forged signature -> 401 and logged; replayed webhook -> 200 and not applied twice")

other = next(o for o in ok(f"{API}/view", role="dispatcher")["orders"] if o["outlet_id"] != "OUT029")
day = ok(f"{API}/view", role="dispatcher")["day"]["id"]
payload = "rl1.%s.%s" % (day, __import__("base64").urlsafe_b64encode(json.dumps({"c": {"type": "receive", "ref": other["order_ref"], "ok": True}}).encode()).decode().rstrip("="))
body = {"object": "whatsapp_business_account", "entry": [{"id": "1", "changes": [{"field": "messages", "value": {"messaging_product": "whatsapp", "messages": [
    {"from": STORE, "id": f"wamid.TEST{uuid.uuid4().hex}", "timestamp": str(int(time.time())), "type": "button", "button": {"payload": payload, "text": "All received"}}]}}]}]}
raw = json.dumps(body).encode()
sig = "sha256=" + hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
s, out = req(f"{API}/whatsapp/webhook", raw=raw, headers={"x-hub-signature-256": sig})
assert s == 200, out
log = ok(f"{API}/whatsapp/console", role="dispatcher")["log"]
assert any("not its order; refused" in (r["note"] or "") for r in log), [r["note"] for r in log[:5]]
assert ok(f"{API}/view", role="dispatcher")["states"][other["order_ref"]]["stage"] != "received"
step(f"a signed webhook from OUT029 trying to confirm {other['outlet_id']}'s order was refused")

# Meta retries a webhook it didn't see answered: the same message id twice is applied once.
s2, _ = req(f"{API}/whatsapp/webhook", raw=raw, headers={"x-hub-signature-256": sig})
assert s2 == 200
log = ok(f"{API}/whatsapp/console", role="dispatcher")["log"]
assert any("already applied" in (r["note"] or "") for r in log), [r["note"] for r in log[:5]]
step("the same signed webhook delivered twice was applied once ('duplicate … already applied')")
print("PASS")
