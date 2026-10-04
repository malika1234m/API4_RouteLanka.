-- The capacity outlook for any night: a forecast for every calendar week, and for weeks in the delivery history the
-- volume the stores actually ordered. The API shows the ten weeks from the night being run.
ALTER TABLE capacity_outlook ADD COLUMN actual_total numeric;
ALTER TABLE capacity_outlook ADD COLUMN actual_chilled numeric;
