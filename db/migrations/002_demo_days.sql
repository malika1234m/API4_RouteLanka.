-- Create a new demo day as a copy of the seeded template: same orders, plan proposal and fleet,
-- nothing published or delivered yet. Returns the new workspace id.
CREATE FUNCTION clone_template_day(day_name text, make_default boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  tpl uuid;
  new_id uuid;
BEGIN
  SELECT id INTO tpl FROM workspaces WHERE is_template;
  IF tpl IS NULL THEN
    RAISE EXCEPTION 'no template demo day: run the seed job first';
  END IF;

  IF make_default THEN
    UPDATE workspaces SET is_default = false WHERE is_default;
  END IF;

  INSERT INTO workspaces (name, service_date, is_default, clock_start, clock_speed, meta)
  SELECT day_name, service_date, make_default, now(), clock_speed, meta FROM workspaces WHERE id = tpl
  RETURNING id INTO new_id;

  INSERT INTO vehicle_day (workspace_id, vehicle_id, status, fuel_used_l)
  SELECT new_id, vehicle_id, status, fuel_used_l FROM vehicle_day WHERE workspace_id = tpl;

  INSERT INTO orders (workspace_id, order_ref, outlet_id, brand, district, depot, temp_requirement, order_units,
                      order_weight_kg, order_volume_m3, deferred_yesterday, days_since_last_served, run_date, source, placed_at)
  SELECT new_id, order_ref, outlet_id, brand, district, depot, temp_requirement, order_units,
         order_weight_kg, order_volume_m3, deferred_yesterday, days_since_last_served, run_date, source, placed_at
  FROM orders WHERE workspace_id = tpl;

  INSERT INTO assignments (workspace_id, order_ref, decision, reason, vehicle_id, trip_id, stop_seq, plan_arrival,
                           pred_arrival, pred_window, pred_service_min, pred_late_prob, priority)
  SELECT new_id, order_ref, decision, reason, vehicle_id, trip_id, stop_seq, plan_arrival,
         pred_arrival, pred_window, pred_service_min, pred_late_prob, priority
  FROM assignments WHERE workspace_id = tpl;

  INSERT INTO trips (workspace_id, vehicle_id, trip_id, brand, district, depot, depart, minutes, km, fuel_l)
  SELECT new_id, vehicle_id, trip_id, brand, district, depot, depart, minutes, km, fuel_l
  FROM trips WHERE workspace_id = tpl;

  INSERT INTO order_progress (workspace_id, order_ref)
  SELECT new_id, order_ref FROM orders WHERE workspace_id = tpl;

  INSERT INTO driver_status (workspace_id, vehicle_id)
  SELECT new_id, vehicle_id FROM driver_status WHERE workspace_id = tpl;

  INSERT INTO user_prefs (workspace_id, role)
  SELECT new_id, r FROM unnest(ARRAY['dispatcher', 'loader', 'driver', 'store']) AS r;

  RETURN new_id;
END;
$$;
