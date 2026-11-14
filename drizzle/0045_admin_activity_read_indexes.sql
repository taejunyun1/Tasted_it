-- B06 read paths only. Normalize legacy SQLite/ISO timestamps without rewriting records.
CREATE INDEX admin_audit_activity_order_idx ON admin_audit_logs(julianday(created_at) DESC, id DESC);
CREATE INDEX admin_operation_activity_order_idx ON admin_operations(julianday(created_at) DESC, id DESC);
CREATE INDEX admin_audit_operation_link_idx ON admin_audit_logs(action, target_type, target_id, actor_user_id);
