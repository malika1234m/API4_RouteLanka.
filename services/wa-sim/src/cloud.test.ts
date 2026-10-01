import { describe, expect, it } from "vitest";
import { buildPayload } from "@routelanka/domain";
import { validate } from "./cloud";

const WS = "8d3b4c2e-1f5a-4b6c-9d7e-0a1b2c3d4e5f";
const msg = {
  order_ref: "K1-036",
  template: "🚧 Your delivery is held up on the way ({r}). New estimate **{w}**.",
  vars: { r: { $t: "road blocked" }, w: "07:39–08:09" },
  replies: [
    { label: "We'll wait", command: { type: "storeReply", ref: "K1-036", reply: "wait" } },
    { label: "Can't receive, send tomorrow", command: { type: "storeReply", ref: "K1-036", reply: "tomorrow" } },
  ],
};

describe("the simulator validates like the Cloud API", () => {
  it("accepts what RouteLanka sends, as a template or free-form, in every language", () => {
    for (const lang of ["en", "si", "ta"] as const)
      for (const open of [false, true]) {
        const v = validate(buildPayload(msg, "94770000104", lang, WS, open) as never);
        expect("error" in v ? v.error : "ok").toBe("ok");
      }
  });
  it("shows the template's approved text around the variable, with the buttons' payloads", () => {
    const v = validate(buildPayload(msg, "94770000104", "en", WS, false) as never);
    if ("error" in v) throw new Error(v.error);
    expect(v.msg.text).toMatch(/^Waypoint delivery update: .* \(RouteLanka\)$/);
    expect(v.msg.buttons.map((b) => b.title)).toEqual(["We'll wait", "Send tomorrow"]);
  });
  it("refuses unapproved templates, wrong parameters, long button titles and bad numbers", () => {
    const t = buildPayload(msg, "94770000104", "en", WS, false) as unknown as { template: { name: string; components: unknown[] } };
    expect(validate({ ...t, template: { ...t.template, name: "made_up" } } as never)).toHaveProperty("error");
    expect(validate({ ...t, template: { ...t.template, components: [t.template.components[0]] } } as never)).toHaveProperty("error");
    const i = buildPayload(msg, "94770000104", "en", WS, true) as unknown as { interactive: { action: { buttons: { reply: { title: string } }[] } } };
    i.interactive.action.buttons[0].reply.title = "A title that is far too long";
    expect(validate(i as never)).toHaveProperty("error");
    expect(validate({ messaging_product: "whatsapp", to: "+94 77", type: "text", text: { body: "hi" } })).toHaveProperty("error");
  });
});
