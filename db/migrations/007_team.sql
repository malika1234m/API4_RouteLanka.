-- Staff accounts managed by dispatchers (the Team screen).
--   active   a deactivated account can't sign in, and its open sessions stop working
--   is_demo  the four seeded accounts the judge walkthrough uses: kept as they are, and the store's
--            demo account may still switch between outlets
ALTER TABLE users ADD COLUMN active  boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN created_by uuid REFERENCES users ON DELETE SET NULL;
-- A store manager covers one store (outlet_id), or every store in a district as its area manager (district).
ALTER TABLE users ADD COLUMN district text;

-- Every account that exists before this migration was created by the seed job.
UPDATE users SET is_demo = true;

-- Each role is tied to the work it covers.
ALTER TABLE users ADD CONSTRAINT users_scope CHECK (
  (role <> 'store'  OR outlet_id  IS NOT NULL OR district IS NOT NULL) AND
  (role <> 'driver' OR vehicle_id IS NOT NULL)
);

-- One active driver account per vehicle: the phone on a vehicle is how the dispatcher hears from its run.
CREATE UNIQUE INDEX users_one_driver_per_vehicle ON users (vehicle_id) WHERE role = 'driver' AND active;
