-- NULL preserves the registration first-name default; an empty string means callsign only.
ALTER TABLE activate_ri_ops_memberships ADD COLUMN chat_display_name TEXT;
