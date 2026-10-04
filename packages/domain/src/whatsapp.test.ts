import { describe, expect, it } from "vitest";
import { buildPayload, decodeReply, encodeReply, isStop, joinText, parseJoin, templateCatalogue, templateFor, waMeLink, type StoreMessage } from "./whatsapp";

const WS = "8d3b4c2e-1f5a-4b6c-9d7e-0a1b2c3d4e5f";
const deferral: StoreMessage = {
  order_ref: "S1-033",
  template: "Your {k} delivery is **not coming tomorrow morning**. Reason: {r}. It moves to **Saturday 25 April** and you are first in line.",
  vars: { k: { $t: "chilled" }, r: { $t: "refrigerated capacity full" } },
  replies: [{ label: "Noted, thanks", command: { type: "ack", ref: "S1-033", via: "whatsapp" } }],
};
const late: StoreMessage = {
  order_ref: "K1-036",
  template: "🚧 Your delivery is held up on the way ({r}). New estimate **{w}**.",
  vars: { r: { $t: "road blocked" }, w: "07:39–08:09" },
  replies: [
    { label: "We'll wait", command: { type: "storeReply", ref: "K1-036", reply: "wait" } },
    { label: "Can't receive, send tomorrow", command: { type: "storeReply", ref: "K1-036", reply: "tomorrow" } },
  ],
};
const delivered: StoreMessage = {
  order_ref: "K1-035",
  template: "📦 Delivered at {t}: {a} of {b} {u}, verified with your handover code. Please check and confirm.",
  vars: { t: "05:48", a: 63, b: 63, u: { $t: "crates" } },
  replies: [{ label: "✅ All received", command: { type: "receive", ref: "K1-035", ok: true } }, { label: "⚠️ Report a problem", link: "/store/receive/K1-035" }],
};

describe("reply payloads", () => {
  it("round-trip a store command and the demo day it belongs to, under 256 characters", () => {
    const id = encodeReply({ workspace: WS, command: { type: "storeReply", ref: "K1-036", reply: "wait" } });
    expect(id.length).toBeLessThan(256);
    expect(decodeReply(id)).toEqual({ workspace: WS, command: { type: "storeReply", ref: "K1-036", reply: "wait" } });
    expect(decodeReply(encodeReply({ workspace: WS, report: "K1-035" }))).toEqual({ workspace: WS, report: "K1-035" });
  });
  it("ignore anything that isn't ours", () => {
    expect(decodeReply("hello")).toBeNull();
    expect(decodeReply(`rl1.${WS}.not-json`)).toBeNull();
  });
});

describe("outbound messages", () => {
  it("outside the 24-hour window use the approved template, with each button's payload", () => {
    const p = buildPayload(late, "94770000104", "en", WS, false);
    expect(p.type).toBe("template");
    if (p.type !== "template") return;
    expect(p.template.name).toBe("routelanka_late");
    const [body, b0, b1] = p.template.components;
    expect(body.parameters[0]).toMatchObject({ type: "text" });
    expect((body.parameters[0] as { text: string }).text).toContain("*07:39–08:09*"); // WhatsApp bold
    expect(decodeReply((b0.parameters[0] as { payload: string }).payload)).toMatchObject({ command: { reply: "wait" } });
    expect(decodeReply((b1.parameters[0] as { payload: string }).payload)).toMatchObject({ command: { reply: "tomorrow" } });
  });
  it("inside the window send reply buttons, titles within 20 characters, in the store's language", () => {
    for (const lang of ["en", "si", "ta"] as const) {
      const p = buildPayload(late, "94770000104", lang, WS, true);
      expect(p.type).toBe("interactive");
      if (p.type !== "interactive") continue;
      expect(p.interactive.action.buttons).toHaveLength(2);
      for (const b of p.interactive.action.buttons) expect([...b.reply.title].length).toBeLessThanOrEqual(20);
    }
    const si = buildPayload(deferral, "94770000029", "si", WS, true);
    expect(JSON.stringify(si)).toMatch(/[඀-෿]/);
  });
  it("pick the template that has the message's buttons", () => {
    expect(templateFor(deferral)).toBe("routelanka_update_ack");
    expect(templateFor(late)).toBe("routelanka_late");
    expect(templateFor(delivered)).toBe("routelanka_delivered");
    expect(templateFor({ template: "🚚 Your delivery left the depot at {t} on {v}. Expected {w}." })).toBe("routelanka_update");
  });
  it("a 'Report a problem' tap asks for the report link", () => {
    const p = buildPayload(delivered, "94770000029", "en", WS, false);
    if (p.type !== "template") throw new Error("expected a template");
    expect(decodeReply((p.template.components[2].parameters[0] as { payload: string }).payload)).toEqual({ workspace: WS, report: "K1-035" });
  });
});

describe("template catalogue (what Meta approves)", () => {
  const all = templateCatalogue();
  it("covers every template in English, Sinhala and Tamil", () => {
    expect(all).toHaveLength(4 * 3);
  });
  it("never starts or ends a body with a variable, and keeps quick replies within 25 characters", () => {
    for (const t of all) {
      const body = t.components.find((c) => c.type === "BODY") as { text: string };
      expect(body.text.trim().startsWith("{{")).toBe(false);
      expect(body.text.trim().endsWith("}}")).toBe(false);
      const buttons = (t.components.find((c) => c.type === "BUTTONS") as { buttons: { text: string }[] } | undefined)?.buttons ?? [];
      for (const b of buttons) expect([...b.text].length).toBeLessThanOrEqual(25);
    }
  });
});

describe("connecting a store's WhatsApp", () => {
  it("reads the JOIN message the link fills in, and nothing looser", () => {
    expect(parseJoin(joinText("OUT034", "048213"))).toEqual({ outlet: "OUT034", code: "048213" });
    expect(parseJoin("  join out034   048213 ")).toEqual({ outlet: "OUT034", code: "048213" });
    expect(parseJoin("JOIN OUT034 48213")).toBeNull();
    expect(parseJoin("JOIN OUT034 048213 please")).toBeNull();
    expect(parseJoin("hello")).toBeNull();
  });
  it("treats STOP as turning WhatsApp off", () => {
    expect(isStop("stop")).toBe(true);
    expect(isStop(" STOP ")).toBe(true);
    expect(isStop("stop the truck")).toBe(false);
  });
  it("builds a wa.me link with the message encoded", () => {
    expect(waMeLink("94110000000", "JOIN OUT034 048213")).toBe("https://wa.me/94110000000?text=JOIN%20OUT034%20048213");
  });
});
