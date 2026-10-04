/** The simulator's browser page: store phones on WhatsApp, and the wire log (every API call and webhook). */
export const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Cloud API simulator · RouteLanka</title>
<style>
  :root { --green:#075e54; --teal:#128c7e; --bg:#efeae2; --me:#d9fdd3; --ink:#111b21; --mute:#667781; --line:#e9edef; }
  * { box-sizing:border-box } body { margin:0; font:14px/1.4 system-ui, -apple-system, "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif; color:var(--ink); background:#f0f2f5 }
  header { background:var(--green); color:#fff; padding:12px 16px } header h1 { margin:0; font-size:17px } header p { margin:4px 0 0; font-size:12px; opacity:.85 }
  main { display:grid; grid-template-columns: 260px minmax(320px, 420px) 1fr; gap:12px; padding:12px; height:calc(100vh - 64px) }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; height:auto } }
  .card { background:#fff; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; min-height:0 }
  .card h2 { margin:0; padding:10px 12px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--mute); border-bottom:1px solid var(--line) }
  .list { overflow:auto } .ph { padding:10px 12px; border-bottom:1px solid var(--line); cursor:pointer } .ph:hover,.ph.on { background:#f5f6f6 }
  .ph b { display:block } .ph small { color:var(--mute); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .badge { float:right; background:#25d366; color:#fff; border-radius:10px; padding:0 7px; font-size:11px }
  .chat { background:var(--bg); flex:1; overflow:auto; padding:12px }
  .top { background:var(--teal); color:#fff; padding:10px 12px } .top small { display:block; opacity:.85 }
  .b { max-width:88%; margin:6px 0; padding:7px 9px 4px; border-radius:8px; background:#fff; box-shadow:0 1px .5px #0002; white-space:pre-wrap; word-wrap:break-word }
  .b.me { margin-left:auto; background:var(--me) } .meta { font-size:11px; color:var(--mute); text-align:right; margin-top:3px }
  .meta .st { font-weight:600 } .st.read { color:#53bdeb } .st.failed { color:#c0392b }
  .btns { display:grid; gap:4px; margin:4px 0 8px; max-width:88% } .btns button { background:#fff; border:0; border-radius:8px; padding:8px; color:#027eb5; font-weight:600; cursor:pointer; box-shadow:0 1px .5px #0002 }
  .btns button[disabled] { color:var(--mute); cursor:default } .tag { display:inline-block; font-size:10px; background:#eef; color:#335; border-radius:4px; padding:0 4px; margin-right:4px }
  form { display:flex; gap:6px; padding:8px; background:#f0f2f5 } form.new input { font-size:16px } form input { flex:1; border:0; border-radius:20px; padding:9px 14px } form button { border:0; background:var(--teal); color:#fff; border-radius:20px; padding:0 14px }
  .wire { overflow:auto; font-size:12px } .w { border-bottom:1px solid var(--line); padding:7px 10px; cursor:pointer } .w .code { font-weight:700 } .w.bad .code { color:#c0392b } .w.good .code { color:#1e8e3e }
  .w .dir { display:inline-block; width:84px; white-space:nowrap; color:var(--mute) } .tools label { font-size:12px; display:flex; align-items:center; gap:4px; margin-left:auto } pre { background:#0b141a; color:#d1d7db; padding:8px; border-radius:6px; overflow:auto; max-height:300px; font-size:11px; white-space:pre-wrap }
  .tools { display:flex; gap:6px; padding:8px; border-bottom:1px solid var(--line) } .tools button { border:1px solid var(--line); background:#fff; border-radius:6px; padding:6px 8px; cursor:pointer; font-size:12px }
  .empty { color:var(--mute); padding:16px; text-align:center }
</style></head>
<body>
<header><h1>WhatsApp Cloud API simulator</h1>
<p>RouteLanka's notifier sends to this service exactly as it would to Meta (<code>POST /v21.0/{phone-number-id}/messages</code>), and this service signs status and reply webhooks with the app secret, as Meta does. Open a store, tap a reply, and watch the wire log.</p></header>
<main>
  <section class="card"><h2>Store phones</h2><div class="list" id="phones"></div></section>
  <section class="card" id="phone"><div class="empty">Choose a store phone. OUT029 (+94 77 000 0029) is the walkthrough's store.</div></section>
  <section class="card"><h2>Wire log: Cloud API calls and webhooks</h2>
    <div class="tools"><button id="replay" title="Send the last webhook again, as Meta does when it doesn't get a 200">Replay last webhook</button><button id="forge" title="A webhook signed with the wrong secret">Send a forged webhook</button><label><input type="checkbox" id="mine" checked> only the open phone</label><label><input type="checkbox" id="stat"> status webhooks</label></div>
    <div class="wire" id="wire"></div></section>
</main>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[c]);
const fmt = (n) => "+" + n.slice(0,2) + " " + n.slice(2,4) + " " + n.slice(4,7) + " " + n.slice(7);
const outlet = (n) => /^94770000\\d{3}$/.test(n) ? "OUT" + n.slice(-3) : "";
const wa = (s) => esc(s).replace(/\\*([^*\\n]+)\\*/g, "<b>$1</b>");
const time = (t) => new Date(t).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
const qs = new URLSearchParams(location.search);
let state = { phones: [], wire: [] }, open = qs.get("phone"), seen = {}, openWire = new Set();
// A wa.me-style link: open WhatsApp with a message ready to send (the store's JOIN message).
let prefill = qs.get("text") || "";
const post = (p, b) => fetch("/wa-sim/api/" + p, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(b || {}) }).then((r) => r.json());

function renderPhones() {
  $("#phones").innerHTML = state.phones.length ? state.phones.map((p) => {
    const last = p.messages.at(-1); const unread = p.messages.filter((m) => m.from === "business" && m.status !== "read" && m.status !== "failed").length;
    return '<div class="ph' + (p.number === open ? " on" : "") + '" data-n="' + p.number + '"><b>' + (outlet(p.number) ? outlet(p.number) + " · " : "") + fmt(p.number) + (unread && p.number !== open ? '<span class="badge">' + unread + "</span>" : "") + "</b><small>" + esc(last ? last.text : "") + "</small></div>";
  }).join("") : '<div class="empty">No messages yet. Publish the plan in RouteLanka and stores start receiving them.</div>';
  document.querySelectorAll(".ph").forEach((el) => el.onclick = () => { open = el.dataset.n; history.replaceState(null, "", "?phone=" + open); post("read", { phone: open }); render(); });
}

/** A link with a message but no phone yet: which phone is sending it? (On a real phone, that's simply your phone.) */
const guess = "9477" + String(Math.floor(1000000 + Math.random() * 8999999));
function renderNew() {
  const box = $("#phone");
  if (!prefill || box.dataset.mode === "new") return; // drawn once, so the number being typed survives a refresh
  box.dataset.mode = "new";
  box.innerHTML = '<div class="top"><b>Send from which phone?</b><small>On a real phone the link opens WhatsApp on that phone. Here, pick the phone number that sends it.</small></div>' +
    '<form class="new"><input id="newnum" inputmode="numeric" pattern="[0-9]{8,15}" value="' + guess + '" aria-label="Phone number, digits only"><button>Open chat</button></form>' +
    '<div class="chat"><div class="b me">' + esc(prefill) + '<div class="meta">ready to send</div></div></div>';
  box.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const n = $("#newnum").value.replace(/\D/g, "");
    if (n.length < 8) return;
    open = n; history.replaceState(null, "", "?phone=" + n + "&text=" + encodeURIComponent(prefill)); render();
  };
}

function renderPhone() {
  const p = state.phones.find((x) => x.number === open) || (open && prefill ? { number: open, messages: [] } : null);
  if (!p) return renderNew();
  $("#phone").dataset.mode = "chat";
  const box = $("#phone"); const chat = box.querySelector(".chat"); const atBottom = !chat || chat.scrollTop + chat.clientHeight > chat.scrollHeight - 30;
  box.innerHTML = '<div class="top"><b>Waypoint Deliveries ✓</b><small>on ' + (outlet(p.number) || "") + " " + fmt(p.number) + "'s phone · business account " + esc(state.config.phoneNumberId) + '</small></div><div class="chat">' +
    p.messages.map((m) => {
      if (m.from === "customer") return '<div class="b me">' + wa(m.text) + '<div class="meta">' + time(m.at) + "</div></div>";
      const kind = m.kind === "template" ? '<span class="tag">template ' + esc(m.template) + " · " + esc(m.lang) + "</span>" : '<span class="tag">' + esc(m.kind) + "</span>";
      const st = '<span class="st ' + esc(m.status) + '">' + esc(m.status) + (m.error ? " (" + esc(m.error) + ")" : "") + "</span>";
      const btns = m.buttons.length ? '<div class="btns">' + m.buttons.map((b, i) => '<button data-m="' + m.id + '" data-i="' + i + '"' + (m.tapped || m.status === "failed" ? " disabled" : "") + ">" + esc(b.title) + "</button>").join("") + "</div>" : "";
      return '<div class="b">' + wa(m.text) + '<div class="meta">' + kind + time(m.at) + " · " + st + "</div></div>" + btns;
    }).join("") + '</div><form><input placeholder="Type a message" aria-label="Type a message"><button>Send</button></form>';
  const c = box.querySelector(".chat"); if (atBottom) c.scrollTop = c.scrollHeight;
  box.querySelectorAll(".btns button").forEach((el) => el.onclick = () => { el.disabled = true; post("tap", { phone: open, messageId: el.dataset.m, button: Number(el.dataset.i) }).then(load); });
  const input = box.querySelector("form input");
  if (prefill && !input.value) input.value = prefill;
  box.querySelector("form").onsubmit = (e) => { e.preventDefault(); const i = box.querySelector("input"); if (i.value.trim()) post("text", { phone: open, text: i.value.trim() }).then(load); i.value = ""; if (prefill) { prefill = ""; history.replaceState(null, "", "?phone=" + open); } };
  const n = p.messages.length; if (seen[open] !== n) { seen[open] = n; post("read", { phone: open }); }
}

function renderWire() {
  const mine = $("#mine").checked && open, stat = $("#stat").checked;
  $("#wire").innerHTML = state.wire.filter((w) => (stat || !w.status) && (!mine || !w.phone || w.phone === open)).map((w, k) => {
    const id = w.at + ":" + k;
    return '<div class="w ' + (w.ok ? "good" : "bad") + '" data-k="' + esc(id) + '"><span class="dir">' + (w.direction === "api" ? "→ API" : "← webhook") + '</span><span class="code">' + (w.http || "—") + "</span> " + esc(w.summary) + ' <span style="color:var(--mute)">' + time(w.at) + "</span>" +
      (openWire.has(id) ? (w.headers ? "<pre>" + esc(JSON.stringify(w.headers, null, 2)) + "</pre>" : "") + "<pre>request " + esc(JSON.stringify(w.request, null, 2)) + "</pre><pre>response " + esc(JSON.stringify(w.response, null, 2)) + "</pre>" : "") + "</div>";
  }).join("") || '<div class="empty">Nothing on the wire yet.</div>';
  document.querySelectorAll(".w").forEach((el) => el.onclick = () => { const k = el.dataset.k; openWire.has(k) ? openWire.delete(k) : openWire.add(k); renderWire(); });
}

function render() { renderPhones(); renderPhone(); renderWire(); }
async function load() { state = await fetch("/wa-sim/api/state").then((r) => r.json()); render(); }
$("#replay").onclick = () => post("replay").then(load);
$("#forge").onclick = () => post("forged").then(load);
$("#mine").onchange = renderWire; $("#stat").onchange = renderWire;
load(); setInterval(load, 1500);
</script></body></html>`;
