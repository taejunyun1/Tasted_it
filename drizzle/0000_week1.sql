PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'REVIEWER', 'ADMIN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE places (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'HIDDEN')),
  address TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN 33 AND 39),
  longitude REAL NOT NULL CHECK (longitude BETWEEN 124 AND 132),
  phone TEXT,
  parking_summary TEXT,
  hero_image_url TEXT,
  kakao_place_id TEXT,
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX places_status_idx ON places(status);
CREATE INDEX places_search_text_idx ON places(search_text);

CREATE TABLE place_categories (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (place_id, category_id)
);
CREATE INDEX place_categories_category_place_idx ON place_categories(category_id, place_id);

CREATE TABLE vote_events (
  id TEXT PRIMARY KEY NOT NULL,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATE', 'CHANGE', 'WITHDRAW')),
  previous_event_id TEXT REFERENCES vote_events(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX vote_events_place_user_idx ON vote_events(place_id, user_id);

CREATE TABLE current_votes (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES vote_events(id) ON DELETE RESTRICT,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (place_id, user_id)
);

CREATE TABLE saved_places (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, place_id)
);
