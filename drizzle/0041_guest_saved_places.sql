-- CST DEC-04: temporary choices share the existing guest session's expiry.
CREATE TABLE guest_saved_places (
  session_id TEXT NOT NULL REFERENCES guest_taste_sessions(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, place_id)
);
CREATE TRIGGER guest_saved_places_limit BEFORE INSERT ON guest_saved_places
WHEN NOT EXISTS (SELECT 1 FROM guest_saved_places WHERE session_id=NEW.session_id AND place_id=NEW.place_id)
 AND (SELECT count(*) FROM guest_saved_places WHERE session_id=NEW.session_id) >= 50
BEGIN SELECT RAISE(ABORT, 'GUEST_SAVE_LIMIT'); END;
-- Absence in legacy saved_places is not inferred to be an explicit unsave.
-- New explicit member choices are retained until changed or account deletion.
CREATE TABLE member_save_choices (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  saved INTEGER NOT NULL CHECK (saved IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, place_id)
);
