-- B02: session-bound, short-lived previews and atomic command receipts.
CREATE TABLE admin_session_assurances (
 session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 method TEXT NOT NULL CHECK(method IN ('PASSWORD','GOOGLE','NAVER','EMAIL')),
 verified_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE admin_operations (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('CSV_IMPORT','RATING_RECOMPUTE','INTEGRITY_CASE_TRANSITION','VOTE_INVALIDATE','ADMIN_ROLE_CHANGE','ADMIN_SESSIONS_REVOKE','TEMP_PUBLISH','TEMP_UNPUBLISH')),
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
 payload_json TEXT CHECK(payload_json IS NULL OR length(payload_json)<=2097152),
 payload_hash TEXT NOT NULL,
 summary_json TEXT NOT NULL CHECK(length(summary_json)<=8192),
 requires_recent_auth INTEGER NOT NULL CHECK(requires_recent_auth IN (0,1)),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMMITTED')),
 result_json TEXT CHECK(result_json IS NULL OR length(result_json)<=8192),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 committed_at TEXT,
 CHECK((status='PENDING' AND payload_json IS NOT NULL AND result_json IS NULL AND committed_at IS NULL)
  OR (status='COMMITTED' AND payload_json IS NULL AND result_json IS NOT NULL AND committed_at IS NOT NULL))
);
CREATE INDEX admin_operation_pending_idx ON admin_operations(actor_user_id,status,expires_at);
CREATE TRIGGER admin_operation_insert_guard BEFORE INSERT ON admin_operations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.id=NEW.session_id AND s.user_id=NEW.actor_user_id AND s.expires_at>NEW.created_at
   AND u.role='ADMIN' AND u.email NOT LIKE 'withdrawn.%@invalid.local')
  THEN RAISE(ABORT,'ADMIN_REQUIRED') END;
 SELECT CASE WHEN (SELECT count(*) FROM admin_operations WHERE actor_user_id=NEW.actor_user_id AND status='PENDING' AND expires_at>NEW.created_at)>=20
  THEN RAISE(ABORT,'ADMIN_OPERATION_LIMIT') END;
END;
CREATE TRIGGER admin_operation_identity_immutable BEFORE UPDATE OF id,kind,actor_user_id,payload_hash,summary_json,requires_recent_auth,created_at,expires_at ON admin_operations
 BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
-- Session revocation may null its FK; the receipt itself remains immutable.
CREATE TRIGGER admin_operation_committed_immutable BEFORE UPDATE OF status,payload_json,result_json,committed_at ON admin_operations WHEN OLD.status='COMMITTED'
 BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
CREATE TRIGGER admin_operation_session_binding BEFORE UPDATE OF session_id ON admin_operations
 WHEN NEW.session_id IS NOT NULL AND NEW.session_id IS NOT OLD.session_id
 BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
CREATE TABLE admin_operation_commits (
 operation_id TEXT PRIMARY KEY REFERENCES admin_operations(id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 committed_at TEXT NOT NULL
);
CREATE TRIGGER admin_operation_commit_guard BEFORE INSERT ON admin_operation_commits BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_operations o JOIN sessions s ON s.id=o.session_id JOIN users u ON u.id=s.user_id
  WHERE o.id=NEW.operation_id AND o.status='PENDING' AND o.kind=NEW.kind
   AND o.actor_user_id=NEW.actor_user_id AND o.session_id=NEW.session_id
   AND s.user_id=o.actor_user_id AND s.expires_at>NEW.committed_at AND o.expires_at>NEW.committed_at
   AND u.role='ADMIN' AND u.email NOT LIKE 'withdrawn.%@invalid.local')
  THEN RAISE(ABORT,'ADMIN_OPERATION_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM admin_operations WHERE id=NEW.operation_id AND requires_recent_auth=1)
  AND NOT EXISTS(SELECT 1 FROM admin_session_assurances a WHERE a.session_id=NEW.session_id
   AND a.actor_user_id=NEW.actor_user_id AND a.verified_at<=NEW.committed_at AND a.expires_at>NEW.committed_at)
  THEN RAISE(ABORT,'ADMIN_RECENT_AUTH_REQUIRED') END;
END;
CREATE TRIGGER admin_operation_commit_no_update BEFORE UPDATE ON admin_operation_commits BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
CREATE TRIGGER admin_operation_commit_no_delete BEFORE DELETE ON admin_operation_commits BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
CREATE TABLE admin_operation_checks (
 operation_id TEXT NOT NULL REFERENCES admin_operation_commits(operation_id) ON DELETE RESTRICT,
 check_name TEXT NOT NULL,
 passed INTEGER NOT NULL CHECK(passed=1),
 PRIMARY KEY(operation_id,check_name)
);
CREATE TRIGGER admin_operation_audit_no_update BEFORE UPDATE OF id,action,target_type,target_id,before_state,after_state,created_at ON admin_audit_logs
 WHEN OLD.action='ADMIN_OPERATION_COMMITTED' BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
CREATE TRIGGER admin_operation_audit_actor_binding BEFORE UPDATE OF actor_user_id ON admin_audit_logs
 WHEN OLD.action='ADMIN_OPERATION_COMMITTED' AND NEW.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NOT OLD.actor_user_id
 BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
CREATE TRIGGER admin_operation_audit_no_delete BEFORE DELETE ON admin_audit_logs
 WHEN OLD.action='ADMIN_OPERATION_COMMITTED' BEGIN SELECT RAISE(ABORT,'ADMIN_OPERATION_IMMUTABLE'); END;
