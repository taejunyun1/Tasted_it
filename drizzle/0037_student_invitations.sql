CREATE TABLE student_seats (
  code TEXT PRIMARY KEY NOT NULL CHECK (code IN ('A','B','C','D')),
  label TEXT NOT NULL,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  can_classify_places INTEGER NOT NULL DEFAULT 0 CHECK (can_classify_places IN (0,1)),
  can_classify_reviews INTEGER NOT NULL DEFAULT 0 CHECK (can_classify_reviews IN (0,1)),
  can_record_qa INTEGER NOT NULL DEFAULT 1 CHECK (can_record_qa IN (0,1)),
  can_approve_registration INTEGER NOT NULL DEFAULT 0 CHECK (can_approve_registration IN (0,1)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Exclusive expiry: 2027-01-01 00:00 KST. No user identity is provisioned here.
INSERT INTO student_seats
  (code,label,can_classify_places,can_classify_reviews,can_approve_registration,expires_at,created_at,updated_at)
VALUES
  ('A','학생 A',1,0,1,'2026-12-31T15:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
  ('B','학생 B',1,0,1,'2026-12-31T15:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
  ('C','학생 C',0,1,0,'2026-12-31T15:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z'),
  ('D','학생 D',0,1,0,'2026-12-31T15:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z');

CREATE TABLE student_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  seat_code TEXT NOT NULL REFERENCES student_seats(code) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX student_invitation_open_seat_idx
  ON student_invitations(seat_code) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX student_invitation_expiry_idx ON student_invitations(expires_at);
