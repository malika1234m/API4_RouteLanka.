/** Input validation. Every command and phone record is checked against these before any handler runs. */
import { z } from "zod";

const ref = z.string().min(1).max(40);
const hhmm = z.string().regex(/^\d\d:\d\d$/);
const role = z.enum(["dispatcher", "loader", "driver", "store"]);
const issue = z.object({ kind: z.enum(["missing", "damaged", "temperature", "short"]), qty: z.number().int().min(1).max(10000), note: z.string().max(500).optional() });
const reason = z.enum(["reefer_capacity", "reefer_van_unavailable", "reefer_van_capacity", "van_capacity", "time_budget", "fuel_quota", "fleet_capacity", "dispatcher_choice"]);
const delayReason = z.enum(["road_blocked", "slow_traffic", "weather", "vehicle"]);

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("publish") }),
  z.object({ type: z.literal("proposePlan") }),
  z.object({ type: z.literal("move"), ref, vehicle_id: z.string(), trip_id: z.number().int() }),
  z.object({ type: z.literal("defer"), ref, reason }),
  z.object({ type: z.literal("loadTick"), ref }),
  z.object({ type: z.literal("loadUntick"), ref }),
  z.object({ type: z.literal("loadFlag"), ref, issue }),
  z.object({ type: z.literal("shortfallDecision"), ref, decision: z.enum(["send_short", "hold", "defer_rest"]) }),
  z.object({ type: z.literal("ready"), key: z.string() }),
  z.object({ type: z.literal("depart"), key: z.string() }),
  z.object({ type: z.literal("setOnline"), online: z.boolean() }),
  z.object({ type: z.literal("reassign"), ref, to: z.string() }),
  z.object({ type: z.literal("ackConflict"), ref }),
  z.object({ type: z.literal("receive"), ref, ok: z.boolean(), issue: issue.optional() }),
  z.object({
    type: z.literal("placeOrder"),
    outlet_id: z.string().optional(),
    lines: z.array(z.object({ temp: z.enum(["chilled", "ambient"]), units: z.number().int().min(0).max(5000), volume_m3: z.number().min(0).max(60), weight_kg: z.number().min(0).max(20000) })).min(1).max(10),
  }),
  z.object({ type: z.literal("resolve"), id: z.string().uuid() }),
  z.object({ type: z.literal("setLang"), role, lang: z.enum(["en", "si", "ta"]) }),
  z.object({ type: z.literal("ack"), ref, via: z.enum(["whatsapp", "app"]) }),
  z.object({ type: z.literal("repair"), vehicle_id: z.string(), note: z.string().max(500) }),
  z.object({ type: z.literal("hire"), district: z.string(), m3: z.number().min(0), cost: z.number().min(0), note: z.string().max(500) }),
  z.object({ type: z.literal("reportDelay"), reason: delayReason, minutes: z.number().int().min(5).max(600), near: z.string().max(120), label: z.string().max(80) }),
  z.object({ type: z.literal("planDelay"), plan: z.record(ref, z.enum(["late", "move", "defer"])), moveTo: z.string().optional(), summary: z.string().max(1000) }),
  z.object({ type: z.literal("storeReply"), ref, reply: z.enum(["wait", "tomorrow"]) }),
]);

const pod = z.object({ name: z.string().max(120), method: z.enum(["signature", "photo", "code"]), code: z.string().regex(/^\d{4}$/).optional() });

export const syncSchema = z.object({
  offline: z.boolean(),
  events: z
    .array(
      z.object({
        id: z.string().uuid(),
        order_ref: ref,
        type: z.enum(["arrived", "delivered"]),
        at: hhmm,
        payload: z.object({ deliveredUnits: z.number().int().min(0).optional(), exception: z.enum(["short", "refused", "damaged", "closed"]).optional(), pod: pod.optional() }).optional(),
      }),
    )
    .max(200),
});

export const loginSchema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });
export const smsSchema = z.object({ token: z.string(), from: z.string().max(30).optional(), body: z.string().max(480) });
