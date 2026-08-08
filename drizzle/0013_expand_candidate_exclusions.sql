ALTER TABLE business_license_exclusions RENAME TO business_license_exclusions_legacy;

DROP INDEX business_license_exclusions_status_idx;

CREATE TABLE business_license_exclusions (
  business_license_id TEXT PRIMARY KEY NOT NULL REFERENCES business_licenses(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('CHAIN_STORE','ADULT_ENTERTAINMENT','ADMIN_EXCEPTION')),
  exclusion_category TEXT NOT NULL CHECK(exclusion_category IN ('CHAIN_STORE','ADULT_ENTERTAINMENT','BUSINESS_TYPE','NOT_RESTAURANT','BAD_OR_DUPLICATE_DATA','POLICY','OTHER')),
  matched_rule TEXT,
  chain_name TEXT,
  matched_term TEXT,
  matched_brand TEXT,
  matched_alias TEXT,
  chain_scope TEXT CHECK(chain_scope IN ('NATIONAL_CHAIN','REGIONAL_CHAIN','LOCAL_CHAIN','UNKNOWN')),
  match_method TEXT,
  match_confidence REAL,
  note TEXT,
  excluded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','OVERRIDDEN','CLEARED')),
  excluded_at TEXT NOT NULL,
  overridden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  overridden_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO business_license_exclusions (
  business_license_id, reason, exclusion_category, matched_rule, chain_name, matched_term,
  matched_brand, matched_alias, chain_scope, match_method, match_confidence, status,
  excluded_at, overridden_by, overridden_at, created_at, updated_at
)
SELECT
  business_license_id, reason, 'CHAIN_STORE', matched_rule, chain_name, matched_term,
  chain_name, CASE WHEN matched_term = chain_name THEN NULL ELSE matched_term END,
  'NATIONAL_CHAIN', 'LEGACY_MATCH', 0.95, status,
  excluded_at, overridden_by, overridden_at, created_at, updated_at
FROM business_license_exclusions_legacy;

DROP TABLE business_license_exclusions_legacy;

CREATE INDEX business_license_exclusions_status_idx
  ON business_license_exclusions(status, updated_at);

INSERT OR IGNORE INTO business_license_exclusions (
  business_license_id, reason, exclusion_category, matched_rule, match_method,
  match_confidence, status, excluded_at, created_at, updated_at
)
SELECT
  id, 'ADULT_ENTERTAINMENT', 'ADULT_ENTERTAINMENT',
  CASE WHEN replace(business_subtype, ' ', '') LIKE '%유흥주점영업%' THEN 'SUBTYPE_ADULT_BAR' ELSE 'NAME_ROOM_SALON' END,
  CASE WHEN replace(business_subtype, ' ', '') LIKE '%유흥주점영업%' THEN 'SUBTYPE_EXACT' ELSE 'NAME_CONTAINS' END,
  1.0, 'ACTIVE', datetime('now'), datetime('now'), datetime('now')
FROM business_licenses
WHERE normalized_status = 'OPEN'
  AND review_status = 'PENDING'
  AND (
    replace(business_subtype, ' ', '') LIKE '%유흥주점영업%'
    OR replace(business_name, ' ', '') LIKE '%룸살롱%'
    OR replace(business_name, ' ', '') LIKE '%룸싸롱%'
  );

WITH franchise_brands(chain_id, chain_name, term) AS (VALUES
  ('LOTTERIA','롯데리아','롯데리아'), ('MCDONALDS','맥도날드','맥도날드'),
  ('BURGER_KING','버거킹','버거킹'), ('KFC','KFC','KFC'), ('MOMS_TOUCH','맘스터치','맘스터치'),
  ('SUBWAY','써브웨이','써브웨이'), ('SUBWAY','써브웨이','서브웨이'),
  ('STARBUCKS','스타벅스','스타벅스'), ('A_TWOSOME_PLACE','투썸플레이스','투썸플레이스'),
  ('EDIYA_COFFEE','이디야커피','이디야커피'), ('MEGA_MGC_COFFEE','메가MGC커피','메가MGC커피'),
  ('MEGA_MGC_COFFEE','메가MGC커피','메가커피'), ('COMPOSE_COFFEE','컴포즈커피','컴포즈커피'),
  ('PAIKS_COFFEE','빽다방','빽다방'), ('THE_VENTI','더벤티','더벤티'), ('HOLLYS','할리스','할리스'),
  ('ANGEL_IN_US','엔제리너스','엔제리너스'), ('PASCUCCI','파스쿠찌','파스쿠찌'),
  ('PAUL_BASSETT','폴바셋','폴바셋'), ('COFFEE_BEAN','커피빈','커피빈'),
  ('KYOCHON_CHICKEN','교촌치킨','교촌치킨'), ('BBQ','BBQ','BBQ'), ('BHC','BHC','BHC'),
  ('GOOBNE_CHICKEN','굽네치킨','굽네치킨'), ('NENE_CHICKEN','네네치킨','네네치킨'),
  ('CHEOGAJIP','처갓집양념치킨','처갓집양념치킨'), ('PELICANA','페리카나','페리카나'),
  ('MEXICANA','멕시카나','멕시카나'), ('60_CHICKEN','60계치킨','60계치킨'),
  ('PURADAK','푸라닭','푸라닭'), ('NORANG_TONGDAK','노랑통닭','노랑통닭'), ('JICOBA','지코바','지코바'),
  ('DOMINOS_PIZZA','도미노피자','도미노피자'), ('PIZZA_HUT','피자헛','피자헛'),
  ('MISTER_PIZZA','미스터피자','미스터피자'), ('PAPA_JOHNS','파파존스','파파존스'),
  ('PIZZA_SCHOOL','피자스쿨','피자스쿨'), ('PIZZA_MARU','피자마루','피자마루'),
  ('BANOLIM_PIZZA','반올림피자','반올림피자'), ('YUPDAK','동대문엽기떡볶이','동대문엽기떡볶이'),
  ('YUPDAK','동대문엽기떡볶이','엽기떡볶이'), ('SINJEON_TTEOKBOKKI','신전떡볶이','신전떡볶이'),
  ('JAWS_TTEOKBOKKI','죠스떡볶이','죠스떡볶이'), ('YOUNG_DABANG','청년다방','청년다방'),
  ('DOOKKI','두끼','두끼'), ('KIMGANE','김가네','김가네'), ('YUMSEM','얌샘김밥','얌샘김밥'),
  ('KIM_TEACHER','바르다김선생','바르다김선생'), ('GOBONGMIN','고봉민김밥인','고봉민김밥'),
  ('HONGKONG_BANJUM','홍콩반점0410','홍콩반점'), ('BOBAE_BANJUM','보배반점','보배반점'),
  ('IBIGA_JJAMPPONG','이비가짬뽕','이비가짬뽕'), ('TANGHUA_KUNGFU','탕화쿵푸마라탕','탕화쿵푸'),
  ('BONJUK','본죽','본죽'), ('BONJUK_BIBIMBAP','본죽&비빔밥','본죽비빔밥'), ('HANSOT','한솥도시락','한솥도시락'),
  ('MYUNGRYUN_JINSA','명륜진사갈비','명륜진사갈비'), ('HANAM_PIG','하남돼지집','하남돼지집'),
  ('GOBAN','고반식당','고반식당'), ('PALGAKDO','팔각도','팔각도'),
  ('WON_HALMEONI','원할머니보쌈족발','원할머니보쌈'), ('BEST_JOKBAL','가장맛있는족발','가장맛있는족발'),
  ('MAWANG_JOKBAL','마왕족발','마왕족발'), ('CHAESUNDANG','채선당','채선당'),
  ('SHABU_HYANG','샤브향','샤브향'), ('SHABU20','샤브20','샤브20'),
  ('OUTBACK','아웃백스테이크하우스','아웃백'), ('ASHLEY_QUEENS','애슐리퀸즈','애슐리'), ('VIPS','빕스','빕스'),
  ('PARIS_BAGUETTE','파리바게뜨','파리바게뜨'), ('PARIS_BAGUETTE','파리바게뜨','파리바게트'),
  ('PARIS_BAGUETTE','파리바게뜨','파리베게뜨'), ('PARIS_BAGUETTE','파리바게뜨','파리베게트'),
  ('TOUS_LES_JOURS','뚜레쥬르','뚜레쥬르'), ('TOUS_LES_JOURS','뚜레쥬르','뜌레쥬르'),
  ('DUNKIN','던킨','던킨'), ('KRISPY_KREME','크리스피크림도넛','크리스피크림'),
  ('BASKIN_ROBBINS','배스킨라빈스','배스킨라빈스'), ('BASKIN_ROBBINS','배스킨라빈스','베스킨라빈스'),
  ('SULBING','설빙','설빙'), ('YOAJUNG','요아정','요아정'),
  ('YEKJEON_HALMEONI','역전할머니맥주','역전할머니맥주'), ('YEKJEON_HALMEONI','역전할머니맥주','역전할맥'),
  ('DAILY_BEER','생활맥주','생활맥주'), ('CROWN_HOF','크라운호프','크라운호프'),
  ('GOLD_STAR_BEER','금별맥주','금별맥주'), ('YONGYONG','용용선생','용용선생'),
  ('HANSHIN_POCHA','한신포차','한신포차'), ('TUDARI','투다리','투다리')
), normalized_licenses AS (
  SELECT id, lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    business_name, ' ', ''), '·', ''), '.', ''), ',', ''), '(', ''), ')', ''), '-', ''), '_', ''), '&', '')) AS normalized_name
  FROM business_licenses
  WHERE normalized_status = 'OPEN' AND review_status = 'PENDING'
), matches AS (
  SELECT l.id, b.chain_id, b.chain_name, b.term,
    row_number() OVER (PARTITION BY l.id ORDER BY length(b.term) DESC) AS match_order
  FROM normalized_licenses l
  JOIN franchise_brands b ON l.normalized_name LIKE lower(replace(b.term, '&', '')) || '%'
)
INSERT OR IGNORE INTO business_license_exclusions (
  business_license_id, reason, exclusion_category, matched_rule, chain_name, matched_term,
  matched_brand, matched_alias, chain_scope, match_method, match_confidence,
  status, excluded_at, created_at, updated_at
)
SELECT id, 'CHAIN_STORE', 'CHAIN_STORE', chain_id, chain_name, term,
  chain_name, CASE WHEN chain_name = term THEN NULL ELSE term END, 'NATIONAL_CHAIN',
  CASE WHEN chain_name = term THEN 'BRAND_PREFIX' ELSE 'ALIAS_PREFIX' END,
  CASE WHEN chain_name = term THEN 0.95 ELSE 0.90 END,
  'ACTIVE', datetime('now'), datetime('now'), datetime('now')
FROM matches WHERE match_order = 1;
