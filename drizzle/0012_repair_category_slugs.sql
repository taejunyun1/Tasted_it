UPDATE categories SET slug = 'ramen-detail', name = '라멘', updated_at = datetime('now')
WHERE id = 'cat-ramen' AND slug = 'ramen';

UPDATE categories SET slug = 'donkatsu-detail', name = '돈가스', updated_at = datetime('now')
WHERE id = 'cat-donkatsu' AND slug = 'donkatsu';

UPDATE categories SET slug = 'gukbap-detail', name = '국밥·해장국', updated_at = datetime('now')
WHERE id = 'cat-gukbap' AND slug = 'gukbap';

UPDATE categories SET slug = 'bakery-detail', name = '베이커리', updated_at = datetime('now')
WHERE id = 'cat-bakery' AND slug = 'bakery';
