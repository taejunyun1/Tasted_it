# 장소 제안 지도 위치 선택·관리자 승인 안정화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 장소 제안에서 위도·경도 직접 입력을 제거하고 NAVER 지도 위치 확인으로 대체하며, 관리자 위치 보정과 중복 없는 승인·카드 단위 오류 UX를 완성한다.

**구조:** 기존 NAVER Maps SDK 로더에 geocoder 서브모듈과 엄격한 타입을 추가한다. 위치 검증은 순수 모듈로 공유하고 회원·관리자 UI는 같은 `PlaceLocationPicker`를 재사용한다. 저장과 승인은 서버에서 재검증하며 승인 작업은 조건부 D1 batch와 사후 조건 확인으로 하나의 장소만 만든다.

**기술 스택:** React 19, React Router 8 loader/action, TypeScript strict, Zod, Drizzle ORM, Cloudflare D1, NAVER Maps Dynamic Map, Vitest, Workers integration, Playwright

**구현 기록 (2026-08-14):** 작업 소유자는 `codex/tj-place-suggestion-map-impl`에서 구현했다. unit 678개, Workers/D1 integration 290개, 위치·관리자 E2E 12개, 홈·일반 지도 E2E 50개, typecheck와 production build를 통과했다. PR 병합 뒤 운영 QA 계정으로 실제 NAVER 검색 한 건과 승인 한 건을 검수한 후 배포한다.

## 전역 제약

- [ ] 구현은 최신 `origin/main`에서 새 `codex/` feature branch와 독립 worktree로 시작한다.
- [ ] Issue #99 또는 구현 PR에 담당자, 아래 소유 파일, migration 없음, NAVER 외부 호출 범위, 비용·개인정보·rollback을 기록한다.
- [ ] 새 패키지, 새 외부 공급자, 새 비밀값, 새 DB 테이블을 추가하지 않는다. 같은 NAVER 애플리케이션의 별도 계량 Geocoding 사용은 구현 PR의 비용·쿼터 승인 범위로 명시한다.
- [ ] `NAVER_MAPS_CLIENT_ID`를 재사용하고 NAVER 장소 ID를 D1에 저장하지 않는다.
- [ ] `NAVER_PLACE_GEOCODING_ENABLED`의 안전 기본값은 `false`다. 이번 PR은 소유자가 NAVER Console의 Geocoding 상품·허용 URL·호출 상한을 확인한 뒤 운영 환경에서 `true`로 활성화하며, 롤백은 즉시 `false`로 되돌린다.
- [ ] 실제 NAVER 호출은 수동 staging QA에서만 수행하고 unit/integration/E2E는 fake SDK로 검증한다.
- [ ] 각 Task는 RED → 최소 GREEN → 관련 회귀 → `git diff --check` → 자체 검수 → 한국어 커밋 순서로 수행한다.
- [ ] 제품 코드의 상태를 `PROPOSED`에서 `ACCEPTED`로 바꾸는 것은 이 계획과 설계를 포함한 PR 병합으로만 승인한다.

---

## Task 1. 위치 계약과 NAVER geocoder SDK 경계

**소유 파일**

- Create: `app/features/maps/place-location.ts`
- Modify: `app/features/maps/naver-map-sdk.ts`
- Modify: `app/types/naver-maps.d.ts`
- Modify: `app/cloudflare-env.d.ts`
- Modify: `.dev.vars.example`
- Modify: `wrangler.jsonc`
- Create: `tests/unit/place-location.test.ts`
- Modify: `tests/unit/naver-map-sdk.test.ts`

### 1.1 RED — 위치 검증과 SDK URL 계약

- [ ] `tests/unit/place-location.test.ts`에 다음 table-driven 테스트를 먼저 작성한다.
  - 광주광역시·전라남도 주소 허용
  - 서울·부산·빈 주소 거부
  - `NaN`, `Infinity`, 경계 밖 위경도 거부
  - 최초 위치에서 2km 이하 이동 허용, 초과 이동 거부
  - 지오코더 후보 최대 5개, 도로명 주소 우선, 중복 제거
- [ ] `tests/unit/naver-map-sdk.test.ts`에 SDK URL이 `submodules=geocoder`를 정확히 한 번 포함하는지 작성한다.
- [ ] 아래 명령으로 대상 테스트가 모듈 또는 함수 부재 때문에 실패하는지 확인한다.

```bash
pnpm test -- tests/unit/place-location.test.ts tests/unit/naver-map-sdk.test.ts
```

예상: 신규 export 부재 또는 assertion 실패.

### 1.2 GREEN — 순수 위치 모듈

- [ ] `app/features/maps/place-location.ts`에 다음 공개 계약을 구현한다.

```ts
export type PlaceCoordinate = Readonly<{ latitude: number; longitude: number }>;

export type GeocodedPlaceCandidate = Readonly<{
  address: string;
  roadAddress: string | null;
  jibunAddress: string | null;
  coordinate: PlaceCoordinate;
}>;

export type PlaceLocationValidation =
  | { ok: true; coordinate: PlaceCoordinate }
  | { ok: false; code: "LOCATION_REQUIRED" | "LOCATION_OUT_OF_SCOPE" | "LOCATION_TOO_FAR_FROM_ADDRESS" };

export function isSupportedRegionAddress(address: string): boolean;
export function validatePlaceCoordinate(input: PlaceCoordinate): PlaceLocationValidation;
export function validateAdjustedCoordinate(origin: PlaceCoordinate, adjusted: PlaceCoordinate): PlaceLocationValidation;
export function normalizeGeocodeCandidates(items: readonly NaverGeocodeAddress[]): GeocodedPlaceCandidate[];
```

- [ ] 좌표 상수는 `SUPPORTED_LOCATION_BOUNDS`, 핀 이동 상한은 `MAX_PIN_ADJUSTMENT_METERS = 2_000`으로 이름을 부여한다.
- [ ] 거리 계산은 저장소의 기존 WGS84 거리 유틸리티를 재사용한다. 없다면 이 순수 모듈에 Haversine 구현을 두고 중복 구현을 만들지 않는다.
- [ ] 주소 정규화는 표시용 원문을 보존하고 비교 시에만 공백을 정규화한다.

### 1.3 GREEN — SDK 로더와 타입

- [ ] `buildNaverMapsScriptUrl(clientId)`가 항상 다음 형태를 만들도록 수정한다.

```ts
https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=...&submodules=geocoder
```

- [ ] `app/types/naver-maps.d.ts`에 최소 계약만 추가한다.

```ts
namespace naver.maps {
  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  class Marker {
    constructor(options: { map: Map; position: LatLng; draggable?: boolean; icon?: { content: HTMLElement; anchor: Point } });
    getPosition(): LatLng;
    setPosition(position: LatLng): void;
    setMap(map: Map | null): void;
  }

  namespace Service {
    enum Status { OK, ERROR }
    function geocode(
      options: { query: string },
      callback: (status: Status, response: { v2: { addresses: NaverGeocodeAddress[] } }) => void,
    ): void;
  }
}

interface NaverGeocodeAddress {
  roadAddress: string;
  jibunAddress: string;
  x: string;
  y: string;
}
```

- [ ] 이미 DOM에 SDK script가 있으나 `Service.geocode`가 없는 비정상 상태는 성공으로 간주하지 않고 명시적 오류를 반환하도록 `loadNaverMaps`를 보강한다.
- [ ] `app/cloudflare-env.d.ts`, `.dev.vars.example`, `wrangler.jsonc`에 값 없는 kill switch 계약을 추가한다. 운영 기본값은 `false`다.

### 1.4 검증·커밋

- [ ] 대상 unit, 전체 지도 unit, typecheck를 실행한다.

```bash
pnpm test -- tests/unit/place-location.test.ts tests/unit/naver-map-sdk.test.ts tests/unit/place-map.test.ts
pnpm run typecheck
git diff --check
```

- [ ] `TODO`, `FIXME`, 광범위 `any`, 키·주소 로그가 없는지 확인한다.
- [ ] 커밋한다.

```bash
git add app/features/maps/place-location.ts app/features/maps/naver-map-sdk.ts app/types/naver-maps.d.ts app/cloudflare-env.d.ts .dev.vars.example wrangler.jsonc tests/unit/place-location.test.ts tests/unit/naver-map-sdk.test.ts
git commit -m "2026-08-14 장소 제안 위치 계약과 지도 지오코더"
```

---

## Task 2. 재사용 가능한 위치 선택 UI

**소유 파일**

- Create: `app/components/places/PlaceLocationPicker.tsx`
- Modify: `app/app.css`
- Create: `tests/unit/place-location-picker-contract.test.tsx`
- Create: `tests/e2e/place-suggestion-location.spec.ts`

### 2.1 RED — 상호작용 계약

- [ ] component test에 다음을 먼저 작성한다.
  - 주소 검색 전 hidden 좌표가 비어 있음
  - 검색 결과 선택 후 지도·확정 버튼 표시
  - 주소 input 변경 시 확정 좌표 즉시 초기화
  - 검색 없음·지역 밖·SDK 실패 메시지
  - pin drag 후 2km 초과 시 확정 불가
  - 확정 시 hidden `latitude`, `longitude`, `locationConfirmed` 값 생성
- [ ] Playwright에 데스크톱·모바일 fake NAVER SDK fixture를 설치하고 주소 검색 → 후보 선택 → 핀 조정 → 확정 흐름을 RED로 작성한다.

### 2.2 GREEN — 컴포넌트 구현

- [ ] 다음 props로 컴포넌트를 구현한다.

```ts
type PlaceLocationPickerProps = {
  clientId: string;
  namePrefix?: string;
  defaultAddress?: string;
  defaultLatitude?: number | null;
  defaultLongitude?: number | null;
  mode: "MEMBER" | "ADMIN";
  required?: boolean;
  onConfirmedChange?: (confirmed: boolean) => void;
};
```

- [ ] 내부 상태는 `address`, `candidates`, `origin`, `adjusted`, `confirmed`, `status`, `error`만 둔다.
- [ ] 지오코딩은 `지도에서 위치 찾기` click에서만 호출하고 debounce 또는 타이핑 호출을 만들지 않는다.
- [ ] 후보가 여러 개면 radio 목록 최대 5개를 표시하고 자동 확정하지 않는다.
- [ ] 지도 생성·marker listener를 effect cleanup에서 반드시 해제한다.
- [ ] marker drag는 `dragend` 한 번만 처리하고 연속 위치 이벤트로 React state를 과도하게 갱신하지 않는다.
- [ ] 주소가 한 글자라도 바뀌면 `confirmed=false`와 hidden 좌표를 즉시 비운다.
- [ ] 지도 조작이 어려운 사용자를 위해 `원래 위치`, 위·아래·왼쪽·오른쪽 10m 미세 조정 컨트롤을 제공한다.

### 2.3 스타일·접근성

- [ ] `app/app.css`에 기존 디자인 토큰만 사용해 `.place-location-picker` 계열 selector를 추가한다.
- [ ] 모바일 280px, 데스크톱 360px 지도 높이, 44px control, 명확한 focus-visible, reduced-motion을 보장한다.
- [ ] SDK 로딩·검색 상태는 `role="status"`, 오류는 `role="alert"`로 제공한다.
- [ ] 확정 좌표 숫자는 회원 화면에서 숨기고, 관리자 모드에서만 보조 정보로 작게 표시한다.

### 2.4 검증·커밋

- [ ] fake SDK E2E가 네트워크 없이 통과하는지 확인한다.

```bash
pnpm test -- tests/unit/place-location-picker-contract.test.tsx
pnpm exec playwright test tests/e2e/place-suggestion-location.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

- [ ] 데스크톱·모바일 screenshot을 `docs/evidence/2026-08-14-place-location-*.png`로 저장한다.
- [ ] 커밋한다.

```bash
git add app/components/places/PlaceLocationPicker.tsx app/app.css tests/unit/place-location-picker-contract.test.tsx tests/e2e/place-suggestion-location.spec.ts docs/evidence/2026-08-14-place-location-desktop.png docs/evidence/2026-08-14-place-location-mobile.png
git commit -m "2026-08-14 장소 제안 지도 위치 선택 UI"
```

---

## Task 3. 회원 장소 제안에 위치 필수 계약 연결

**소유 파일**

- Modify: `app/routes/place-suggest.tsx`
- Modify: `app/features/places/place-suggestion.server.ts`
- Modify: `tests/integration/place-suggestion.server.test.ts`
- Modify: `tests/e2e/place-suggestion-location.spec.ts`

### 3.1 RED — 서버는 좌표를 다시 검증한다

- [ ] integration에 다음 실패 케이스를 먼저 추가한다.
  - 좌표 없음 → `LOCATION_REQUIRED`
  - `NaN` 또는 범위 밖 좌표 → `LOCATION_OUT_OF_SCOPE`
  - 광주·전남 밖 주소 → `LOCATION_OUT_OF_SCOPE`
  - 정규화 주소는 입력 원문 기반, 좌표는 숫자로 저장
- [ ] 기존 정상 제안 테스트는 확정 좌표를 명시하도록 fixture를 수정한다.

### 3.2 GREEN — loader/action 계약

- [ ] loader가 다음을 반환한다.

```ts
return {
  categories,
  naverMapsClientId: env.NAVER_MAPS_CLIENT_ID ?? "",
  placeGeocodingEnabled: env.NAVER_PLACE_GEOCODING_ENABLED === "true",
};
```

- [ ] action Zod schema를 다음 형태로 변경한다.

```ts
const suggestionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(5).max(300),
  latitude: z.coerce.number().finite(),
  longitude: z.coerce.number().finite(),
  locationConfirmed: z.literal("true"),
  categoryId: z.string().uuid(),
  phone: z.string().trim().max(40).optional(),
  description: z.string().trim().max(1_000).optional(),
});
```

- [ ] schema 통과 후 `isSupportedRegionAddress`와 `validatePlaceCoordinate`를 다시 호출한다.
- [ ] 예상 오류는 root ErrorBoundary를 던지지 않고 `data({ ok:false, ... }, {status:400})`로 반환한다.
- [ ] 서비스 함수 `submitPlaceSuggestion`도 route 호출만 신뢰하지 않고 동일한 위치 검증을 수행한다.

### 3.3 GREEN — 화면 연결

- [ ] 기존 위도·경도 input을 삭제하고 `PlaceLocationPicker mode="MEMBER"`를 연결한다.
- [ ] 위치 미확정 시 submit button은 비활성화하되 서버 검증은 유지한다.
- [ ] action field error를 해당 위치 picker와 필드 아래에 표시하고 사용자 입력을 유지한다.
- [ ] SDK clientId가 비어 있으면 지도 입력을 비활성화하고 운영 오류 메시지를 표시한다.
- [ ] kill switch가 꺼져 있으면 SDK를 로드하거나 geocode를 호출하지 않고 `현재 위치 검색을 잠시 사용할 수 없어요`를 표시한다.

### 3.4 회귀·커밋

- [ ] 회원 입력 전체 경로와 기존 제안 목록 경로를 검증한다.

```bash
pnpm run test:integration -- tests/integration/place-suggestion.server.test.ts
pnpm exec playwright test tests/e2e/place-suggestion-location.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

- [ ] 커밋한다.

```bash
git add app/routes/place-suggest.tsx app/features/places/place-suggestion.server.ts tests/integration/place-suggestion.server.test.ts tests/e2e/place-suggestion-location.spec.ts
git commit -m "2026-08-14 회원 장소 제안 위치 확인 연결"
```

---

## Task 4. 관리자 위치 보정과 카드 단위 오류 UX

**소유 파일**

- Create: `app/components/admin/PlaceSuggestionReviewCard.tsx`
- Modify: `app/routes/admin-place-operations.tsx`
- Modify: `app/features/places/place-suggestion.server.ts`
- Modify: `tests/integration/place-suggestion.server.test.ts`
- Create: `tests/e2e/admin-place-suggestion.spec.ts`

### 4.1 RED — 위치 수정·오류 mapping

- [ ] integration에 `updatePlaceSuggestionLocation` 계약을 작성한다.
  - ADMIN만 호출 가능하다는 route 역할 검증
  - reviewable status에서 주소·좌표 수정 및 audit log
  - 처리 완료 상태 수정 거부
  - 범위 밖 위치 거부
- [ ] E2E에 좌표 없는 legacy 제안의 승인 버튼 비활성 → 지도 위치 확정 → 승인 가능 흐름을 작성한다.
- [ ] `SUGGESTION_COORDINATES_REQUIRED`, reason 누락, 이미 처리됨, 임시 D1 실패가 전체 오류 화면이 아닌 카드 alert로 표시되는지 작성한다.

### 4.2 GREEN — 서비스와 route intent

- [ ] `place-suggestion.server.ts`에 다음 함수를 추가한다.

```ts
export async function updatePlaceSuggestionLocation(db: AppDb, input: {
  suggestionId: string;
  actorUserId: string;
  address: string;
  latitude: number;
  longitude: number;
  now: string;
}): Promise<{ suggestionId: string }>;
```

- [ ] 변경 전·후 주소/좌표와 actor를 `admin_audit_logs`에 남기되 UI action 로그에는 원문을 출력하지 않는다.
- [ ] `admin-place-operations.tsx` action을 `intent` discriminated union으로 바꾼다.

```ts
type Intent = "UPDATE_SUGGESTION_LOCATION" | "APPROVE_SUGGESTION" | "NEED_INFO_SUGGESTION" | "REJECT_SUGGESTION";
```

- [ ] action 전체를 예상 오류 mapping으로 감싸고 JSON union을 반환한다. `throw new Response`는 인증·권한·진짜 404에만 사용한다.
- [ ] mutation에 strict same-origin 검사와 ADMIN role 검사를 적용한다.

### 4.3 GREEN — 카드 컴포넌트

- [ ] suggestion별 `useFetcher`를 가진 `PlaceSuggestionReviewCard`를 만든다.
- [ ] 지도는 기본 접힘이며 열었을 때만 인스턴스를 생성한다.
- [ ] 좌표 없는 항목은 `위치 확인 필요`, 좌표 있는 항목은 `위치 확인 완료`를 표시한다.
- [ ] pending 동안 그 카드만 비활성화하고 `승인 중…`을 표시한다.
- [ ] `fetcher.data.fieldErrors`와 message를 카드 안 `role="alert"`에 표시한다.
- [ ] 성공 후 승인 버튼 대신 생성된 장소 링크를 표시한다.

### 4.4 검증·커밋

- [ ] 200개 fixture에서 닫힌 카드가 지도 인스턴스를 만들지 않는 unit assertion을 추가한다.
- [ ] 다음을 실행한다.

```bash
pnpm run test:integration -- tests/integration/place-suggestion.server.test.ts
pnpm exec playwright test tests/e2e/admin-place-suggestion.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

- [ ] 커밋한다.

```bash
git add app/components/admin/PlaceSuggestionReviewCard.tsx app/routes/admin-place-operations.tsx app/features/places/place-suggestion.server.ts tests/integration/place-suggestion.server.test.ts tests/e2e/admin-place-suggestion.spec.ts
git commit -m "2026-08-14 관리자 장소 제안 위치 보정과 오류 UX"
```

---

## Task 5. 승인 동시성·응답 유실 안전성

**소유 파일**

- Modify: `app/features/places/place-suggestion.server.ts`
- Modify: `app/routes/admin-place-operations.tsx`
- Modify: `tests/integration/place-suggestion.server.test.ts`
- Modify: `tests/e2e/admin-place-suggestion.spec.ts`

### 5.1 RED — 실제 D1 경쟁 테스트

- [ ] 동일 suggestion을 두 Promise에서 동시에 승인하고 다음을 assertion한다.
  - `places` 1행
  - `place_categories` 1행
  - `place_revisions`의 `CREATE_FROM_SUGGESTION` 1행
  - suggestion `APPROVED`, `approved_place_id` 한 값
  - admin audit 승인 1행
- [ ] 동일 승인 요청을 순차 재전송하면 같은 placeId를 반환하는지 작성한다.
- [ ] 실제 `db.batch` commit 뒤 응답만 reject하는 proxy로 모호한 성공 복구 테스트를 작성한다.
- [ ] 중간 statement trigger 실패 시 장소·revision·category·suggestion 상태가 모두 rollback되는지 작성한다.

### 5.2 GREEN — 조건부 승인 batch

- [ ] `approvePlaceSuggestion` 반환 계약을 명시한다.

```ts
type ApproveSuggestionResult =
  | { outcome: "APPROVED"; placeId: string }
  | { outcome: "ALREADY_APPROVED"; placeId: string }
  | { outcome: "CONFLICT"; latestStatus: string };
```

- [ ] 사전 조회는 UX 메시지에만 사용하고 최종 승인을 보장하는 수단으로 사용하지 않는다.
- [ ] `INSERT INTO places (...) SELECT ... FROM place_suggestions WHERE id=? AND status IN ('SUBMITTED','REVIEWING','NEEDS_INFO') AND latitude IS NOT NULL AND longitude IS NOT NULL` 형태의 조건부 생성으로 시작한다.
- [ ] category/revision/audit/suggestion update를 같은 D1 batch에 둔다.
- [ ] 조건부 생성이 0건일 때 batch가 전체 성공하지 않도록 후속 FK 또는 명시적 postcondition statement로 실패시킨다.
- [ ] catch에서 suggestion을 다시 읽는다.
  - `APPROVED + approvedPlaceId`이면 `ALREADY_APPROVED`
  - 그 외 일시 오류면 `APPROVAL_FAILED`
- [ ] DB 오류 문자열을 사용자 응답이나 로그에 그대로 쓰지 않는다.

### 5.3 클라이언트 연타 방어

- [ ] fetcher state 외에 synchronous `useRef` lock을 둬 React render 전에 들어온 두 click도 한 번만 submit하게 한다.
- [ ] 서버가 `ALREADY_APPROVED`를 반환하면 오류 toast가 아니라 기존 성공 상태로 표시한다.
- [ ] E2E에서 `Promise.all([click, click])` 또는 DOM evaluate 연타 후 하나의 장소만 생기는지 확인한다.

### 5.4 mutation proof·커밋

- [ ] 다음 세 변이를 임시로 적용해 테스트가 실패하는지 확인하고 즉시 원복한다.
  - 승인 WHERE status 제거
  - 응답 유실 postcondition 제거
  - client ref lock 제거
- [ ] 최종 검증한다.

```bash
pnpm run test:integration -- tests/integration/place-suggestion.server.test.ts
pnpm exec playwright test tests/e2e/admin-place-suggestion.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
pnpm run build
git diff --check
```

- [ ] 커밋한다.

```bash
git add app/features/places/place-suggestion.server.ts app/routes/admin-place-operations.tsx tests/integration/place-suggestion.server.test.ts tests/e2e/admin-place-suggestion.spec.ts
git commit -m "2026-08-14 장소 제안 승인 중복과 응답 유실 방어"
```

---

## Task 6. 전체 QA·운영 문서·Draft PR

**소유 파일**

- Create: `docs/operations/place-suggestion-map-runbook.md`
- Modify: `README.md`
- Create: `docs/evidence/2026-08-14-place-suggestion-admin-chromium.png`
- Create: `docs/evidence/2026-08-14-place-suggestion-admin-mobile-chromium.png`

### 6.1 전체 검증

- [ ] unit·Workers integration·대상 E2E·typecheck·build를 fresh 실행한다.

```bash
pnpm test
pnpm run test:integration
pnpm exec playwright test tests/e2e/place-suggestion-location.spec.ts tests/e2e/place-operations.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
pnpm run build
git diff --check
```

- [ ] 기존 map category, home curated map, course map smoke를 추가 실행해 SDK URL 변경 회귀를 확인한다.
- [ ] 테스트 실패를 baseline으로 분류하려면 같은 commit의 `origin/main` 비교 실행 증거를 남긴다.

### 6.2 실제 staging QA

- [ ] 운영 데이터가 아닌 QA 계정과 테스트 제안으로 다음을 확인한다.
  - 실제 NAVER 주소 검색 성공
  - 후보 주소 선택과 pin drag
  - 광주·전남 밖 주소 거부
  - 모바일 지도 gesture와 폼 scroll 충돌 없음
  - 관리자 좌표 보정
  - 승인 연타·뒤로가기·새로고침
  - 승인 성공 장소가 public map에는 `DRAFT` 정책대로 즉시 노출되지 않음
- [ ] 실제 장소나 운영 제안을 승인하지 않는다.

### 6.3 runbook

- [ ] `docs/operations/place-suggestion-map-runbook.md`에 다음을 기록한다.
  - 사용 binding: `NAVER_MAPS_CLIENT_ID`
  - kill switch: `NAVER_PLACE_GEOCODING_ENABLED`
  - 같은 NAVER Cloud 애플리케이션의 Dynamic Map·Geocoding 상품 활성 여부와 등록 웹 서비스 URL
  - API 호출 시점과 예상량
  - 일일 쿼터·과금 상한·비용 책임자
  - SDK/geocoder 장애 메시지
  - 400/409/503 관측 코드
  - kill switch와 rollback
  - 개인정보·로그 redaction
  - 승인 응답 유실 확인 쿼리
- [ ] README의 환경 변수 목록은 값 없이 변수명만 유지한다.

### 6.4 최종 자체 검수와 PR

- [ ] 계획 대비 파일·함수·테스트 누락을 표로 확인한다.
- [ ] CSS broad selector, 비밀값, 주소 원문 로그, `eval` 허용, 새 dependency, migration이 없는지 확인한다.
- [ ] 독립 코드 리뷰를 요청하고 Critical/Important를 해결한다.
- [ ] runbook과 evidence를 커밋한다.

```bash
git add docs/operations/place-suggestion-map-runbook.md README.md docs/evidence/2026-08-14-place-suggestion-admin-chromium.png docs/evidence/2026-08-14-place-suggestion-admin-mobile-chromium.png
git commit -m "2026-08-14 장소 제안 지도 운영과 QA 문서"
```

- [ ] feature branch를 push하고 Draft PR을 연다. PR 본문에 다음을 명시한다.
  - Issue #99와 소유 파일
  - 새 공급자·키·dependency·migration 없음, 기존 NAVER 공급자의 계량 Geocoding 호출 확장 있음
  - 실제 NAVER QA의 호출 한도와 대상 환경
  - 테스트·화면 증거
  - rollout·rollback
  - `PROPOSED → ACCEPTED` 승인 범위
- [ ] checks와 diff를 검수한 후에만 ready 전환한다. PR 병합 전 구현·배포·운영 호출을 진행하지 않는다.
