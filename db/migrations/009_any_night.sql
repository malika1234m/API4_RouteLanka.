-- Any night from the history. A judge can start a demo day for a real past date instead of the walkthrough night:
-- that date's orders for both depots, as the stores placed them, planned by the engine.

-- Every order in the supplied delivery history (deliveries_train.csv), loaded by the seed job.
CREATE TABLE order_history (
  order_date       date    NOT NULL,
  outlet_id        text    NOT NULL REFERENCES outlets,
  temp_requirement text    NOT NULL,
  order_units      integer NOT NULL,
  order_weight_kg  numeric NOT NULL,
  order_volume_m3  numeric NOT NULL,
  dispatch_status  text    NOT NULL  -- attempted, deferred or not_run
);
CREATE INDEX order_history_by_date ON order_history (order_date);
CREATE INDEX order_history_by_outlet ON order_history (outlet_id, order_date);

-- A demo day for one night of the history. It starts as a copy of the template (accounts, fleet, personas) and
-- swaps in that night's orders. The plan is left empty for the engine to propose.
--   * a store whose order was deferred or not run the night before is marked deferred_yesterday (must serve);
--   * days_since_last_served counts back to the store's last delivered order (at most 7);
--   * every vehicle is available, and has used the share of its weekly fuel quota usual for that weekday.
CREATE FUNCTION create_history_day(day_name text, night date)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  new_id uuid;
  prev date;
  cal record;
  fest record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_history WHERE order_date = night) THEN
    RAISE EXCEPTION 'no deliveries ran on %', night USING ERRCODE = 'no_data_found';
  END IF;
  new_id := clone_template_day(day_name);

  DELETE FROM trips WHERE workspace_id = new_id;
  DELETE FROM orders WHERE workspace_id = new_id;  -- and, by cascade, their plan rows and progress

  SELECT * INTO cal FROM calendar WHERE date = night;
  SELECT date, festival INTO fest FROM calendar WHERE festival <> '' AND date >= night ORDER BY date LIMIT 1;
  SELECT max(order_date) INTO prev FROM order_history WHERE order_date < night;

  UPDATE workspaces SET service_date = night,
         meta = meta || jsonb_build_object(
           'dow', to_char(night, 'FMDay'),
           'festival', coalesce(initcap(replace(fest.festival, '_', ' ')), ''),
           'festival_date', coalesce(fest.date::text, ''),
           'monsoon', coalesce(cal.monsoon, false)::int,
           'history_date', night::text)
  WHERE id = new_id;

  -- The weekly quota resets on Monday: by Friday a vehicle has typically used a bit over half of it.
  UPDATE vehicle_day d SET status = 'available',
         fuel_used_l = round(v.weekly_fuel_quota_l * (ARRAY[0, 0.15, 0.30, 0.45, 0.55, 0.65, 0.70])[extract(isodow FROM night)::int], 1)
  FROM vehicles v WHERE d.vehicle_id = v.vehicle_id AND d.workspace_id = new_id;

  INSERT INTO orders (workspace_id, order_ref, outlet_id, brand, district, depot, temp_requirement, order_units,
                      order_weight_kg, order_volume_m3, deferred_yesterday, days_since_last_served, run_date, source)
  SELECT new_id,
         (CASE WHEN t.depot = 'Kandy' THEN 'K1-' ELSE 'P1-' END)
           || lpad((row_number() OVER (PARTITION BY t.depot ORDER BY h.outlet_id, h.temp_requirement, h.order_units) - 1)::text, 3, '0'),
         h.outlet_id, t.brand, t.district, t.depot, h.temp_requirement, h.order_units, h.order_weight_kg, h.order_volume_m3,
         (EXISTS (SELECT 1 FROM order_history p WHERE p.order_date = prev AND p.outlet_id = h.outlet_id
                    AND p.temp_requirement = h.temp_requirement AND p.dispatch_status <> 'attempted'))::int,
         least(7, coalesce(night - (SELECT max(s.order_date) FROM order_history s
                                    WHERE s.outlet_id = h.outlet_id AND s.order_date < night AND s.dispatch_status = 'attempted'), 1)),
         night, 'seed'
  FROM order_history h JOIN outlets t USING (outlet_id)
  WHERE h.order_date = night;

  INSERT INTO order_progress (workspace_id, order_ref) SELECT new_id, order_ref FROM orders WHERE workspace_id = new_id;
  RETURN new_id;
END;
$$;
