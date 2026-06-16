ALTER TABLE activate_ri_routes
  ADD COLUMN approval_operation_id TEXT;

CREATE UNIQUE INDEX activate_ri_routes_approval_operation_idx
  ON activate_ri_routes(approval_operation_id)
  WHERE approval_operation_id IS NOT NULL;
