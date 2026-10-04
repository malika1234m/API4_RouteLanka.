-- Each historical order's outcome, so a store's delivery record can be shown as it stood on any night:
-- on_time, late (with minutes after the window closed) or missed (deferred or not run). Filled by the seed job.
ALTER TABLE order_history ADD COLUMN state text CHECK (state IN ('on_time', 'late', 'missed'));
ALTER TABLE order_history ADD COLUMN late_min integer;
