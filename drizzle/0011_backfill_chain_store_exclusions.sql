INSERT OR IGNORE INTO business_license_exclusions(
  business_license_id,
  reason,
  matched_rule,
  chain_name,
  matched_term,
  status,
  excluded_at,
  created_at,
  updated_at
)
SELECT
  id,
  'CHAIN_STORE',
  'EXPLICIT_CHAIN_NAME',
  CASE
    WHEN normalized_name LIKE '%뚜레쥬르%' OR normalized_name LIKE '%뜌레쥬르%' THEN '뚜레쥬르'
    ELSE '파리바게뜨'
  END,
  CASE
    WHEN normalized_name LIKE '%뚜레쥬르%' THEN '뚜레쥬르'
    WHEN normalized_name LIKE '%뜌레쥬르%' THEN '뜌레쥬르'
    WHEN normalized_name LIKE '%파리바게뜨%' THEN '파리바게뜨'
    WHEN normalized_name LIKE '%파리바게트%' THEN '파리바게트'
    WHEN normalized_name LIKE '%파리베게뜨%' THEN '파리베게뜨'
    ELSE '파리베게트'
  END,
  'ACTIVE',
  datetime('now'),
  datetime('now'),
  datetime('now')
FROM (
  SELECT
    id,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
      business_name, ' ', ''), '·', ''), '.', ''), ',', ''), '(', ''), ')', ''), '-', ''), '_', ''), '&', '') AS normalized_name
  FROM business_licenses
  WHERE normalized_status = 'OPEN'
    AND review_status = 'PENDING'
)
WHERE normalized_name LIKE '%뚜레쥬르%'
   OR normalized_name LIKE '%뜌레쥬르%'
   OR normalized_name LIKE '%파리바게뜨%'
   OR normalized_name LIKE '%파리바게트%'
   OR normalized_name LIKE '%파리베게뜨%'
   OR normalized_name LIKE '%파리베게트%';
