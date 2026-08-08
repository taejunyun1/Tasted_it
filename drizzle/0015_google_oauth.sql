CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('GOOGLE')),
  provider_subject TEXT NOT NULL,
  provider_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject),
  UNIQUE(provider, user_id)
);

CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);

CREATE TABLE oauth_requests (
  id TEXT PRIMARY KEY NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX oauth_requests_expiry_idx ON oauth_requests(expires_at, consumed_at);
