CREATE UNIQUE INDEX product_events_guest_event_uidx
  ON product_events(guest_session_id, event_name)
  WHERE guest_session_id IS NOT NULL
    AND event_name IN ('ONBOARDING_STARTED', 'GUEST_CONVERTED');
