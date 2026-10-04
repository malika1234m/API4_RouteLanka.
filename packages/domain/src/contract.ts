/**
 * The API contract shared by the web app and the API service: the day's view model, the commands each
 * role can send, and field records from the driver's phone.
 */
import type { DelayReason } from "./labels";
import type { District, FieldEvent, LineIssue, Order, OrderState, OutletHistory, OutlookWeek, Outlet, ReasonCode, Trip, Vehicle } from "./types";

export type Role = "dispatcher" | "loader" | "driver" | "store";
export type Lang = "en" | "si" | "ta";

export interface FeedItem {
  id: string;
  at: string;
  role: Role;
  kind: "info" | "issue" | "sync" | "decision";
  text: string;
  ref?: string;
  open?: boolean;
}

export interface Personas {
  dispatcher: { name: string; depot: string };
  loader: { name: string; depot: string };
  driver: { name: string; vehicle_id: string; trip_id: number };
  store: { name: string; outlet_id: string };
}

export interface DayMeta {
  dow: string;
  festival: string;
  festival_date: string;
  cutoff: string;
  fresh_budget: number;
  day_budget: number;
  monsoon: number;
  personas: Personas;
  /** Set when the day is a real night from the order history (not the walkthrough night). */
  history_date?: string;
}

/** Data that does not change during a day. */
export interface Reference {
  outlets: Outlet[];
  vehicles: Omit<Vehicle, "status" | "fuel_used_l">[];
  districts: District[];
  allowance: { brand: string; dock_type: string; minutes: number }[];
  outlook: OutlookWeek[];
  outlet_history: Record<string, OutletHistory>;
  road_today: Record<string, number>;
}

export interface DriverView {
  vehicle_id: string;
  trip_id: number;
  /** The driver on this vehicle (from their account). */
  name?: string;
  online: boolean;
  offlineSince?: string;
  lastContact?: string;
  lastContactStop?: string;
  conflicts: { ref: string; to: string }[];
  lastSync?: { at: string; count: number; delivered: number; arrived: number };
  delay?: { at: string; reason: DelayReason; minutes: number; via: "sms" | "app"; near: string; smsDone?: { ref: string; at: string }[]; toldAt?: string };
}

/** A person signed in on this browser, and the work their account covers. */
export interface Person {
  name: string;
  username: string;
  depot?: string;
  outlet_id?: string;
  /** An area manager: every store in this district. */
  district?: string;
  vehicle_id?: string;
  trip_id?: number;
  /** One of the four seeded walkthrough accounts. */
  demo?: boolean;
}

/** Everything a screen needs about the current demo day. Rebuilt by the API from the database. */
export interface DayView {
  /** `next_runs`: the next two operating nights after this one (where a deferred or newly placed order goes). */
  day: { id: string; name: string; service_date: string; clock_start: number; clock_speed: number; meta: DayMeta; next_runs: string[] };
  published: boolean;
  planVersion: number;
  planChangedAt?: string;
  orders: Order[];
  states: Record<string, OrderState>;
  trips: Trip[];
  vehicles: Vehicle[];
  ready: Record<string, boolean>;
  departed: Record<string, string>;
  feed: FeedItem[];
  /** The run of the driver signed in on this browser (the demo run when no driver is signed in). */
  driver: DriverView;
  /** Every run with a driver's phone on it: one per active driver account. */
  drivers: DriverView[];
  /** The people signed in on this browser, one per role. */
  me: Partial<Record<Role, Person>>;
  delayPlan: Record<string, "late" | "move" | "defer">;
  delayToldAt?: string;
  storeReplies: Record<string, { reply: "wait" | "tomorrow"; at: string }>;
  acks: Record<string, string>;
  placed: Order[];
  lang: Record<Role, Lang>;
  fleet: { repairs: string[]; hires: { id: string; at: string; district: string; m3: number; cost: number }[] };
  planJob?: { id: string; status: "queued" | "running" | "done" | "failed"; summary?: Record<string, number>; error?: string };
  /** Only for the driver: salted hashes of the store handover codes, so the phone can check a code offline. */
  codeHashes?: Record<string, string>;
  /** Only for the store manager: the handover codes for their outlet's orders. */
  codes?: Record<string, string>;
}

/** Commands, one per user action. The API checks the sender's role before applying any of them. */
export type Command =
  | { type: "publish" }
  | { type: "proposePlan" }
  | { type: "move"; ref: string; vehicle_id: string; trip_id: number }
  | { type: "defer"; ref: string; reason: ReasonCode }
  | { type: "loadTick"; ref: string }
  | { type: "loadUntick"; ref: string }
  | { type: "loadFlag"; ref: string; issue: LineIssue }
  | { type: "shortfallDecision"; ref: string; decision: NonNullable<OrderState["loadDecision"]> }
  | { type: "ready"; key: string }
  | { type: "depart"; key: string }
  | { type: "setOnline"; online: boolean }
  | { type: "reassign"; ref: string; to: string }
  | { type: "ackConflict"; ref: string }
  | { type: "receive"; ref: string; ok: boolean; issue?: LineIssue }
  | { type: "placeOrder"; outlet_id?: string; lines: { temp: "chilled" | "ambient"; units: number; volume_m3: number; weight_kg: number }[] }
  | { type: "resolve"; id: string }
  | { type: "setLang"; role: Role; lang: Lang }
  | { type: "ack"; ref: string; via: "whatsapp" | "app" }
  | { type: "repair"; vehicle_id: string; note: string }
  | { type: "hire"; district: string; m3: number; cost: number; note: string }
  | { type: "reportDelay"; reason: DelayReason; minutes: number; near: string; label: string }
  | { type: "planDelay"; vehicle_id?: string; plan: Record<string, "late" | "move" | "defer">; moveTo?: string; summary: string }
  | { type: "storeReply"; ref: string; reply: "wait" | "tomorrow" };

export type CommandType = Command["type"];

/** Who may send each command. The prototype's role switcher is kept for judges, so it is not per-user. */
export const COMMAND_ROLES: Record<CommandType, Role[]> = {
  publish: ["dispatcher"],
  proposePlan: ["dispatcher"],
  move: ["dispatcher"],
  defer: ["dispatcher"],
  shortfallDecision: ["dispatcher"],
  reassign: ["dispatcher"],
  resolve: ["dispatcher"],
  repair: ["dispatcher"],
  hire: ["dispatcher"],
  planDelay: ["dispatcher"],
  loadTick: ["loader"],
  loadUntick: ["loader"],
  loadFlag: ["loader"],
  ready: ["loader"],
  depart: ["loader"],
  setOnline: ["driver"],
  ackConflict: ["driver"],
  reportDelay: ["driver"],
  receive: ["store"],
  placeOrder: ["store"],
  ack: ["store"],
  storeReply: ["store"],
  setLang: ["dispatcher", "loader", "driver", "store"],
};

/** A batch of records from the driver's phone, sent when it has signal again. */
export interface SyncRequest {
  events: FieldEvent[];
  /** Demo clock time on the phone when it sent the batch. */
  sentAt: string;
}

export interface SyncResult {
  accepted: number;
  duplicates: number;
  conflicts: { ref: string; to: string }[];
}
