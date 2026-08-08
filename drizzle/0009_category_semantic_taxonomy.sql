INSERT OR IGNORE INTO categories(
  id, slug, name, emoji, sort_order, parent_id, description, is_active, created_at, updated_at
) VALUES (
  'cat-seafood', 'seafood', '해산물', '🐟', 250, NULL, '생선과 해산물 음식', 1, datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO categories(
  id, slug, name, emoji, sort_order, parent_id, description, is_active, created_at, updated_at
) VALUES (
  'cat-seafood-dish', 'seafood-dish', '해산물·생선요리', '🦐', 251, 'cat-seafood', '회, 생선, 갑각류와 연체류 음식', 1, datetime('now'), datetime('now')
);
