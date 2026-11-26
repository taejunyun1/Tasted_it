CREATE TRIGGER place_poi_media_withdraw_on_identity_change
AFTER UPDATE OF name, address ON places
WHEN OLD.name IS NOT NEW.name OR OLD.address IS NOT NEW.address
BEGIN
  INSERT INTO admin_audit_logs (
    id, actor_user_id, action, target_type, target_id, before_state, after_state, created_at
  )
  SELECT
    'poi-media-identity-withdraw-' || id, NULL, 'POI_MEDIA_IDENTITY_WITHDRAWN', 'PLACE_POI_MEDIA', id,
    json_object('state', state),
    json_object(
      'state', 'WITHDRAWN',
      'cause', 'PLACE_IDENTITY_CHANGED',
      'nameChanged', json(CASE WHEN OLD.name IS NOT NEW.name THEN 'true' ELSE 'false' END),
      'addressChanged', json(CASE WHEN OLD.address IS NOT NEW.address THEN 'true' ELSE 'false' END)
    ),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM place_poi_media
  WHERE place_id = OLD.id AND state IN ('STAGED', 'PUBLISHED');

  UPDATE place_poi_media
  SET state = 'WITHDRAWN'
  WHERE place_id = OLD.id AND state IN ('STAGED', 'PUBLISHED');
END;
