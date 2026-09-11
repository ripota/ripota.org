ALTER TABLE activate_ri_media ADD COLUMN title TEXT;
ALTER TABLE activate_ri_media ADD COLUMN description TEXT;
-- New uploads record the notice displayed with the upload action.
ALTER TABLE activate_ri_media ADD COLUMN usage_notice_version TEXT;
