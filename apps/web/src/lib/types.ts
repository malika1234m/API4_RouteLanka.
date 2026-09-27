export type Brand = "Fresh" | "Style" | "Tech";
export type Temp = "chilled" | "ambient";

export interface Outlet {
  outlet_id: string;
  brand: Brand;
  district: string;
  depot: string;
  dock_type: "rear_dock" | "street" | "mall_bay";
  parking_constraint: "normal" | "van_only" | "mall_dock";
  mall_window: string;
  window_open_time: string;
  window_close_time: string;
}

export interface Vehicle {
  vehicle_id: string;
  type: "truck" | "van";
  temp: "reefer" | "ambient";
  weight_cap_kg: number;
  volume_cap_m3: number;
  km_per_l: number;
  weekly_fuel_quota_l: number;
  fuel_used_l: number;
  depot: string;
  status: "available" | "in_workshop";
}

export type ReasonCode =
  | "reefer_capacity"
  | "reefer_van_capacity"
  | "van_capacity"
  | "time_budget"
  | "fuel_quota"
  | "fleet_capacity"
  | "dispatcher_choice";

export interface Order {
  order_ref: string;
  outlet_id: string;
  brand: Brand;
  district: string;
  depot: string;
  dock_type: Outlet["dock_type"];
  parking_constraint: Outlet["parking_constraint"];
  mall_window: string;
  window_open_time: string;
  window_close_time: string;
  temp_requirement: Temp;
  order_units: number;
  order_weight_kg: number;
  order_volume_m3: number;
  deferred_yesterday: number;
  days_since_last_served: number;
  decision: "served" | "deferred";
  reason?: ReasonCode;
  vehicle_id?: string;
  trip_id?: number;
  stop_seq?: number;
  plan_arrival?: string;
  pred_arrival?: string;
  pred_window?: string;
  pred_service_min?: number;
  pred_late_prob?: number;
  priority: number;
}

export interface Trip {
  vehicle_id: string;
  trip_id: number;
  brand: Brand;
  district: string;
  depot: string;
  stops: string[];
  depart: string;
  minutes: number;
  volume_m3: number;
  weight_kg: number;
  km: number;
  fuel_l: number;
}

export interface District {
  district: string;
  depot: string;
  road_class: string;
  depot_to_district_km: number;
  depot_to_district_freeflow_min: number;
  inter_stop_km: number;
  inter_stop_freeflow_min: number;
}

export interface OutlookWeek {
  depot: string;
  iso_week: number;
  total: number;
  chilled: number;
  chilled_capacity: number;
  operating_days: number;
  festival: string;
  paydays: number;
}

export interface Seed {
  meta: { date: string; dow: string; festival: string; festival_date: string; cutoff: string; fresh_budget: number; day_budget: number };
  personas: {
    dispatcher: { name: string; depot: string };
    loader: { name: string; depot: string };
    driver: { name: string; vehicle_id: string; trip_id: number };
    store: { name: string; outlet_id: string };
  };
  outlets: Outlet[];
  vehicles: Vehicle[];
  districts: District[];
  allowance: { brand: Brand; dock_type: string; minutes: number }[];
  orders: Order[];
  trips: Trip[];
  outlook: OutlookWeek[];
}

/** Where an order is in the relay. Each stage is owned by one role. */
export type Stage = "ordered" | "planned" | "loaded" | "on_road" | "delivered" | "received";
export const STAGES: Stage[] = ["ordered", "planned", "loaded", "on_road", "delivered", "received"];

export type LineIssue = { kind: "missing" | "damaged" | "temperature" | "short"; qty: number; note?: string };

export interface OrderState {
  stage: Stage;
  deferred: boolean;
  loadFlag?: LineIssue;
  loadDecision?: "send_short" | "hold" | "defer_rest";
  arrivedAt?: string;
  deliveredAt?: string;
  deliveredUnits?: number;
  exception?: "short" | "refused" | "damaged" | "closed";
  pod?: { name: string; method: "signature" | "photo" };
  recordedOffline?: boolean;
  syncedAt?: string;
  receipt?: { ok: boolean; issue?: LineIssue };
  reassignedTo?: string;
}

/** A field event recorded on the driver's phone. Idempotent by id. */
export interface FieldEvent {
  id: string;
  order_ref: string;
  type: "arrived" | "delivered";
  at: string;
  payload?: Partial<OrderState>;
}
