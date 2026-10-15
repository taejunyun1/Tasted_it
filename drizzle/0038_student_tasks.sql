CREATE TABLE student_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('PLACE','REVIEW','QA')),
  target_id TEXT NOT NULL,
  title TEXT NOT NULL,
  assigned_seat TEXT NOT NULL REFERENCES student_seats(code),
  checker_seat TEXT NOT NULL REFERENCES student_seats(code),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','SUBMITTED','VERIFIED','APPROVED','NEEDS_INFO')),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  classification_json TEXT,
  target_fingerprint TEXT,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  checked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  checked_at TEXT,
  review_note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(assigned_seat <> checker_seat)
);
CREATE INDEX student_task_assignment_idx ON student_tasks(assigned_seat,is_active,updated_at,id);
CREATE INDEX student_task_checker_idx ON student_tasks(checker_seat,is_active,status,updated_at,id);
CREATE UNIQUE INDEX student_place_target_idx ON student_tasks(target_id) WHERE kind = 'PLACE' AND is_active = 1;
CREATE UNIQUE INDEX student_review_target_idx ON student_tasks(target_id) WHERE kind = 'REVIEW' AND is_active = 1;

CREATE TABLE student_task_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES student_tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_seat TEXT NOT NULL REFERENCES student_seats(code),
  event_type TEXT NOT NULL CHECK(event_type IN ('SUBMIT','CHECK','REGISTRATION_ATTEST')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX student_task_revision_idx ON student_task_revisions(task_id,version);
