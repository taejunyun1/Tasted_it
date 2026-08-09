PRAGMA foreign_keys=OFF;

CREATE TABLE auth_identities_naver (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('GOOGLE', 'NAVER')),
  provider_subject TEXT NOT NULL,
  provider_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject),
  UNIQUE(provider, user_id)
);

INSERT INTO auth_identities_naver (
  id, user_id, provider, provider_subject, provider_email, created_at, updated_at
)
SELECT id, user_id, provider, provider_subject, provider_email, created_at, updated_at
FROM auth_identities;

DROP TABLE auth_identities;
ALTER TABLE auth_identities_naver RENAME TO auth_identities;
CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);

ALTER TABLE oauth_requests ADD COLUMN provider TEXT NOT NULL DEFAULT 'GOOGLE'
  CHECK(provider IN ('GOOGLE', 'NAVER'));
ALTER TABLE oauth_requests ADD COLUMN flow TEXT NOT NULL DEFAULT 'LOGIN'
  CHECK(flow IN ('LOGIN', 'CONNECT', 'DISCONNECT'));
ALTER TABLE oauth_requests ADD COLUMN code_verifier TEXT;
ALTER TABLE oauth_requests ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

PRAGMA foreign_keys=ON;
