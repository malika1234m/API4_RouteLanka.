import { COMMAND_ROLES } from "@routelanka/domain";
import { describe, expect, it } from "vitest";
import { commandSchema, syncSchema } from "./schemas";

describe("command validation", () => {
  it("every command the API accepts has a role rule, and every role rule has a command", () => {
    const types = commandSchema.options.map((o) => o.shape.type.value).sort();
    expect(types).toEqual(Object.keys(COMMAND_ROLES).sort());
  });

  it("accepts well-formed commands", () => {
    expect(commandSchema.safeParse({ type: "proposePlan" }).success).toBe(true);
    expect(commandSchema.safeParse({ type: "move", ref: "K1-035", vehicle_id: "VEH041", trip_id: 1 }).success).toBe(true);
    expect(commandSchema.safeParse({ type: "loadFlag", ref: "K1-035", issue: { kind: "missing", qty: 4 } }).success).toBe(true);
  });

  it("rejects unknown commands, bad values and oversized input", () => {
    expect(commandSchema.safeParse({ type: "dropTables" }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "defer", ref: "K1-035", reason: "felt like it" }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "loadFlag", ref: "K1-035", issue: { kind: "missing", qty: 0 } }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "move", ref: "x".repeat(41), vehicle_id: "V", trip_id: 1 }).success).toBe(false);
  });
});

describe("offline sync validation", () => {
  const ev = { id: "8d3b4c2e-1f5a-4b6c-9d7e-0a1b2c3d4e5f", order_ref: "K1-035", type: "delivered", at: "05:50" };
  it("accepts a phone record with a 4-digit handover code", () => {
    expect(syncSchema.safeParse({ offline: true, events: [{ ...ev, payload: { pod: { name: "staff", method: "code", code: "2372" } } }] }).success).toBe(true);
  });
  it("rejects records without a client id (needed for idempotent replays), bad times or bad codes", () => {
    expect(syncSchema.safeParse({ offline: true, events: [{ ...ev, id: "1" }] }).success).toBe(false);
    expect(syncSchema.safeParse({ offline: true, events: [{ ...ev, at: "5:50" }] }).success).toBe(false);
    expect(syncSchema.safeParse({ offline: true, events: [{ ...ev, payload: { pod: { name: "s", method: "code", code: "12345" } } }] }).success).toBe(false);
  });
});
