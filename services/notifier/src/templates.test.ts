import { describe, expect, it } from "vitest";
import { delayNotice, delivered, published, rerouted, type Msg, type OrderRow } from "./templates";

const order = (o: Partial<OrderRow> = {}): OrderRow => ({
  order_ref: "K1-035", outlet_id: "OUT104", brand: "Fresh", temp_requirement: "chilled", order_units: 40, decision: "served", reason: null,
  vehicle_id: "VEH041", pred_window: "05:40–06:00", pred_late_prob: 0.1, window_close_time: "07:00", handover_code: "2372", reassigned_to: null, load_flag: null, ...o,
});

// Every {placeholder} in a template must have a value, or the store sees a raw "{w}".
const filled = (m: Msg) => [...m.template.matchAll(/\{(\w+)\}/g)].every(([, k]) => m.vars?.[k] !== undefined && m.vars?.[k] !== null);

describe("store messages", () => {
  it("a deferred order gets the reason and a one-tap acknowledgement", () => {
    const [m, ...rest] = published(order({ decision: "deferred", reason: "reefer_capacity" }), "2026-04-25");
    expect(rest).toHaveLength(0);
    expect(m.template).toContain("not coming");
    expect(m.replies?.[0].command).toEqual({ type: "ack", ref: "K1-035", via: "whatsapp" });
    expect(filled(m)).toBe(true);
  });

  it("a served order gets its window and, separately, its handover code", () => {
    const [win, code] = published(order(), "2026-04-25");
    expect(win.vars?.w).toBe("05:40–06:00");
    expect(code.vars?.c).toBe("2372");
    expect([win, code].every(filled)).toBe(true);
  });

  it("a likely-late order is warned before the night starts", () => {
    const [m] = published(order({ pred_late_prob: 0.7, pred_window: "07:10–07:30" }), "2026-04-25");
    expect(m.template).toContain("after your window closes");
    expect(filled(m)).toBe(true);
  });

  it("a delay notice offers both replies as real commands", () => {
    const m = delayNotice(order(), "late", "road blocked", { from: "07:10", to: "07:40", late: true });
    expect(m.replies?.map((r) => r.command)).toEqual([
      { type: "storeReply", ref: "K1-035", reply: "wait" },
      { type: "storeReply", ref: "K1-035", reply: "tomorrow" },
    ]);
    expect(filled(m)).toBe(true);
  });

  it("a code-verified delivery says so and asks the store to confirm", () => {
    const m = delivered(order(), { units: 38, method: "code", deliveredAt: "05:50" });
    expect(m.template).toContain("handover code");
    expect(m.vars).toMatchObject({ a: 38, b: 40 });
    expect(m.replies?.[0].command).toEqual({ type: "receive", ref: "K1-035", ok: true });
  });

  it("a stop handed to another vehicle names the new vehicle", () => {
    const m = rerouted(order(), "VEH039");
    expect(m.vars?.v).toBe("VEH039");
    expect(filled(m)).toBe(true);
  });
});
