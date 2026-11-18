# 공개 장소 목록 페이지 처리 검증

2026-11-18 · #471 · 기준 통합 `fac9a96` · 담당 Codex.

## 반영 범위

- 공개 목록은 기존과 같은 100곳씩 읽고 실제 전체 건수와 표시 범위를 구분한다. 이름·ID 순서가 고정된 이전/다음 페이지로 100번째 이후 장소에도 접근한다.
- 검색어·카테고리·bbox·취향 배지·TEMP 조건을 페이지 이동 때 유지한다. 새 검색은 첫 페이지에서 시작하고 이전 상세 시트 선택은 페이지 이동 때 닫는다. 페이지 이동 후 목록 제목으로 초점을 옮긴다.
- 페이지 번호는 한 개의 양의 정수만 허용한다. 0·음수·중복·소수·안전 정수 범위 밖 입력은 400이다. 범위를 벗어난 페이지는 큰 OFFSET 조회를 수행하지 않고 같은 조건의 첫 페이지 복귀를 제공한다.
- 총건수와 목록은 같은 공개 적격 조건을 사용한다. 추천 후보의 최대 500곳·영업 제외 조건·별도 정렬/개인화 의미는 바꾸지 않는다.

## 검색 오류 보완

첫 D1 회귀에서 49자 검색어에 양쪽 `%`를 붙인 기존 LIKE가 `LIKE or GLOB pattern too complex`로 실패했다. 이는 실제 운영 장애가 아니라 로컬 D1에서 확인한 경계다.

사용자 검색은 SQL 와일드카드 명령이 아닌 문자 그대로의 부분 검색으로 처리한다. `instr(lower(...), 검색어)`로 이름·검색 문구·주소를 대조하여 `%`와 `_`도 문자로 찾고 기존 ASCII 대소문자 비교를 유지한다. `instr`는 부분 문자열 위치를 반환하고 SQLite 기본 `lower`의 변환 범위는 ASCII다. 비ASCII 대소문자 처리를 확대하거나 ICU를 추가하지 않았다. [SQLite 공식 함수 설명](https://www.sqlite.org/lang_corefunc.html)

검색 조건을 비교하는 비용과 전체 건수 집계는 남는다. 인덱스 성능 향상이나 대량 동시 접속 성능을 검증했다고 주장하지 않는다. 반환 장소는 요청당 100곳이며 페이지 범위를 확인한 뒤에만 해당 OFFSET을 사용한다.

## 실행 증거

| 명령/범위 | 결과 |
|---|---|
| `pnpm test tests/unit/public-place-pagination.test.ts tests/unit/place-list-contract.test.ts` | 10 PASS |
| `pnpm test:integration tests/integration/public-place-pagination.test.ts tests/integration/place.server.test.ts tests/integration/public-category-viewport.test.ts` | 12 PASS |
| `pnpm run typecheck` | PASS |
| `pnpm audit --prod --audit-level high` | 알려진 운영 의존성 취약점 0 |
| 전용 로컬 5197의 `public-place-pagination.spec.ts`, desktop/mobile | 4 PASS |
| 같은 전용 로컬의 `discovery-feedback.spec.ts --grep 'place search'`, desktop/mobile | 2 PASS |

125개 동명이점의 100+25 분할·누락/중복 없음·안정된 순서, 숨김/지역/TEMP 제외, 긴 검색어와 `%`/`_`·한글/주소/ASCII 대소문자를 D1에서 확인했다. 브라우저에서는 전체 건수/범위, 실제 두 번째 페이지, 잘못된 페이지의 400, 비어버린 페이지 복귀, 검색 변경 시 첫 페이지와 네트워크 실패 후 재검색을 확인했다. 초기 LIKE 실패도 위에 보존했다.

브라우저 데이터는 로컬 합성 125곳이며 정리했다. 실제 GPS·외부 API·메일·운영 DB·배포는 사용하지 않았다. 지정 SHA의 통합 필수 CI와 실제 운영 검증은 별도이며 #397은 HOLD를 유지한다.

화면 증거: [두 번째 페이지 desktop](2026-11-18-public-place-page-two-chromium.png), [mobile](2026-11-18-public-place-page-two-mobile-chromium.png), [범위 밖 복귀 desktop](2026-11-18-public-place-page-recovery-chromium.png), [mobile](2026-11-18-public-place-page-recovery-mobile-chromium.png).
