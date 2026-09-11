-- Existing uploads remain general photos/videos until explicitly associated.
ALTER TABLE activate_ri_media ADD COLUMN park_reference TEXT;
