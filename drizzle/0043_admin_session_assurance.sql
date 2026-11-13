CREATE TABLE admin_reauth_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('EMAIL', 'GOOGLE', 'NAVER')),
  token_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX admin_reauth_challenges_session_idx ON admin_reauth_challenges(session_id, expires_at);

CREATE TABLE admin_role_restorations (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_role TEXT NOT NULL CHECK (previous_role IN ('USER', 'REVIEWER'))
);

-- SQLite serializes writers. This check remains correct if two admins concurrently
-- attempt to demote each other, including writes outside the administration UI.
CREATE TRIGGER users_keep_last_admin_update
BEFORE UPDATE OF role, email_verified_at ON users
WHEN OLD.role = 'ADMIN' AND OLD.email_verified_at IS NOT NULL
  AND (NEW.role <> 'ADMIN' OR NEW.email_verified_at IS NULL)
  AND (SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND email_verified_at IS NOT NULL) <= 1
BEGIN SELECT RAISE(ABORT, 'LAST_ADMIN_REQUIRED'); END;

CREATE TRIGGER users_keep_last_admin_delete
BEFORE DELETE ON users
WHEN OLD.role = 'ADMIN' AND OLD.email_verified_at IS NOT NULL
  AND (SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND email_verified_at IS NOT NULL) <= 1
BEGIN SELECT RAISE(ABORT, 'LAST_ADMIN_REQUIRED'); END;
