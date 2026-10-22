-- Explicitly retained links may share one seat. Acceptance still atomically
-- claims a vacant seat; token hashes and per-user seat ownership stay unique.
DROP INDEX student_invitation_open_seat_idx;
CREATE INDEX student_invitation_active_seat_idx
  ON student_invitations(seat_code) WHERE consumed_at IS NULL AND revoked_at IS NULL;
