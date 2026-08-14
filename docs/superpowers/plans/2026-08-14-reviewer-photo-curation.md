# 리뷰 사진 전체 갤러리·관리자 큐레이션·대표 캐러셀 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 발행된 리뷰어 사진은 장소 상세 하단에서 모두 볼 수 있게 하고, 관리자가 품질을 확인해 선정한 최대 5장만 장소 메인 대표 영역에 노출한다.

**구조:** `reviewer_visit_photos`는 원본 metadata, 새 `reviewer_photo_moderations`는 공개 중단과 대표 선정의 운영 상태를 담당한다. 공개 갤러리는 moderation row가 없으면 PUBLIC인 기본 공개 모델을 사용하고 cursor pagination으로 로드한다. 메인 캐러셀은 기존 `heroImageUrl`과 관리자 선정 사진의 ordered projection만 받으며 자동 재생하지 않는다. 철회된 review는 모든 query와 binary route에서 최우선 제외한다.

**기술 스택:** React 19, React Router 8, TypeScript strict, Drizzle ORM, Cloudflare D1/R2, 기존 design tokens, Vitest, Workers integration, Playwright

## 선행 조건·전역 제약

- [ ] `2026-08-14-reviewer-revisit-withdrawal.md` 구현 PR과 0028 migration이 먼저 병합되어야 한다.
- [ ] 이 작업은 최신 `origin/main`의 별도 branch/worktree에서 수행하고 별도 Issue/PR 소유권을 기록한다.
- [ ] 0029 migration을 새로 추가하고 기존 migration을 수정하지 않는다.
- [ ] Cloudflare Images, 새 CDN, 이미지 분석 AI, 새 패키지를 추가하지 않는다.
- [ ] R2 object key는 DB와 cleanup job의 exact key 계약을 유지한다.
- [ ] 모든 공개 사진 query는 review `PUBLISHED`, reviewer 정책, moderation `PUBLIC`을 함께 확인한다.
- [ ] 대표 미선정과 공개 중단을 같은 상태로 처리하지 않는다.
- [ ] 메인 사진은 관리자 선정 없이는 자동 승격하지 않는다.
- [ ] 각 Task는 RED → GREEN → mutation proof → typecheck/diff-check → 자체 검수 → 한국어 커밋 순서로 진행한다.

---

## Task 1. 사진 moderation·대표 선정 스키마

**소유 파일**

- Create: `drizzle/0029_reviewer_photo_moderations.sql`
- Modify: `app/db/schema.ts`
- Modify: `tests/unit/schema-contract.test.ts`
- Create: `tests/integration/reviewer-photo-moderation-migration.test.ts`

### 1.1 RED — schema와 migration 불변식

- [ ] 다음 계약을 unit/integration에 먼저 작성한다.
  - photo 한 장당 moderation row 최대 1개
  - placeId와 photo.review의 placeId 불일치 방어는 서비스에서 검증
  - status `PUBLIC | HIDDEN`
  - featuredOrder는 null 또는 1~5
  - 한 place에서 featuredOrder 중복 불가
  - actor/timestamp/reason/version 존재
  - 원본 photo 삭제 시 moderation cascade
- [ ] migration 0000→0029와 0028→0029를 각각 실제 D1에서 검증한다.

### 1.2 GREEN — 0029 migration

- [ ] 다음 테이블을 추가한다.

```sql
CREATE TABLE reviewer_photo_moderations (
  photo_id TEXT PRIMARY KEY NOT NULL
    REFERENCES reviewer_visit_photos(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL
    REFERENCES places(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PUBLIC'
    CHECK (status IN ('PUBLIC', 'HIDDEN')),
  featured_order INTEGER
    CHECK (featured_order IS NULL OR (featured_order >= 1 AND featured_order <= 5)),
  reason TEXT,
  selected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  selected_at TEXT,
  hidden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  hidden_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX reviewer_photo_featured_order_uidx
ON reviewer_photo_moderations(place_id, featured_order)
WHERE featured_order IS NOT NULL;

CREATE INDEX reviewer_photo_moderations_place_status_idx
ON reviewer_photo_moderations(place_id, status, featured_order);
```

- [ ] moderation row가 없는 기존 사진은 application query에서 PUBLIC/non-featured로 해석한다. 대량 backfill하지 않는다.
- [ ] `status='HIDDEN'`일 때 `featured_order IS NULL`을 서비스에서 강제하고 integration으로 검증한다.

### 1.3 검증·커밋

```bash
pnpm test -- tests/unit/schema-contract.test.ts
pnpm run test:integration -- tests/integration/reviewer-photo-moderation-migration.test.ts
pnpm run typecheck
git diff --check
```

```bash
git add drizzle/0029_reviewer_photo_moderations.sql app/db/schema.ts tests/unit/schema-contract.test.ts tests/integration/reviewer-photo-moderation-migration.test.ts
git commit -m "2026-08-14 리뷰 사진 공개와 대표 선정 스키마"
```

---

## Task 2. 공개 갤러리와 대표 사진 query 경계

**소유 파일**

- Create: `app/features/ratings/reviewer-photo-curation.server.ts`
- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Modify: `app/routes/reviewer-photo.ts`
- Create: `tests/integration/reviewer-photo-curation.server.test.ts`
- Modify: `tests/integration/reviewer-photo-route.test.ts`

### 2.1 RED — 공개 projection

- [ ] 실제 D1 fixture로 다음을 작성한다.
  - PUBLISHED review + no moderation row → gallery 공개
  - PUBLISHED + PUBLIC row → 공개
  - HIDDEN moderation → gallery와 binary route 모두 제외
  - WITHDRAWN review → moderation 상태와 무관하게 제외
  - featured photo는 ordered query에만 포함
  - 다른 placeId로 잘못 저장된 moderation row는 결과에서 제외
  - reviewer SUSPENDED 정책이 기존 public policy상 제외라면 동일 적용
- [ ] binary route가 제외된 photo에서 R2.get을 호출하지 않는지 fake bucket으로 검증한다.

### 2.2 GREEN — cursor 계약

- [ ] public list 계약을 구현한다.

```ts
export type PublicReviewPhoto = {
  id: string;
  url: string;
  reviewKind: "PRIMARY" | "REVISIT";
  publishedAt: string;
  position: number;
};

export type ReviewPhotoPage = {
  items: PublicReviewPhoto[];
  nextCursor: string | null;
};

export async function listPublishedPlaceReviewPhotosPage(db: AppDb, input: {
  placeId: string;
  limit: number;
  cursor: string | null;
}): Promise<ReviewPhotoPage>;
```

- [ ] cursor는 `publishedAt + reviewId + position + photoId`의 opaque base64url JSON으로 만들고 Zod로 엄격 파싱한다.
- [ ] limit는 서버에서 1~24로 clamp하고 기본 12로 한다.
- [ ] 정렬은 review 최신순, review 내 position 오름차순, photoId tie-break 순으로 고정한다.
- [ ] cursor 없이 offset pagination을 사용하지 않는다.

### 2.3 GREEN — featured projection

- [ ] 대표 query를 분리한다.

```ts
export type FeaturedPlacePhoto = {
  photoId: string;
  url: string;
  order: number;
};

export async function listFeaturedPlaceReviewPhotos(db: AppDb, placeId: string): Promise<FeaturedPlacePhoto[]>;
```

- [ ] `status=PUBLIC`, `featuredOrder IS NOT NULL`, source review PUBLISHED를 모두 만족하고 최대 5장만 반환한다.
- [ ] 기존 `heroImageUrl`은 이 함수에 넣지 않고 route loader에서 조합한다.

### 2.4 binary route cache 정책

- [ ] moderation·철회가 즉시 반영되어야 하므로 reviewer photo 응답을 다음처럼 변경한다.

```http
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

- [ ] 기존 1시간 browser/24시간 edge cache는 제거한다. R2 read 증가 영향을 PR 비용 섹션에 기록한다.
- [ ] range request를 지원하지 않는 현재 계약은 그대로 두고 과도한 원본 용량은 upload 단계에서 이미 제한한다.

### 2.5 검증·커밋

```bash
pnpm run test:integration -- tests/integration/reviewer-photo-curation.server.test.ts tests/integration/reviewer-photo-route.test.ts
pnpm run typecheck
git diff --check
```

```bash
git add app/features/ratings/reviewer-photo-curation.server.ts app/features/ratings/reviewer-visit.server.ts app/routes/reviewer-photo.ts tests/integration/reviewer-photo-curation.server.test.ts tests/integration/reviewer-photo-route.test.ts
git commit -m "2026-08-14 리뷰 사진 공개와 대표 projection"
```

---

## Task 3. 관리자 사진 공개 중단·대표 선정 서비스

**소유 파일**

- Modify: `app/features/ratings/reviewer-photo-curation.server.ts`
- Modify: `app/db/schema.ts` if an existing audit enum must be extended
- Create: `tests/integration/reviewer-photo-curation-admin.test.ts`

### 3.1 RED — 관리자 mutation 불변식

- [ ] 다음을 실제 D1에서 작성한다.
  - public photo feature 성공
  - 6번째 feature 거부
  - 같은 featured order 경쟁 요청 하나만 성공
  - HIDDEN photo feature 거부
  - WITHDRAWN review photo feature 거부
  - 다른 place의 photoId 주입 거부
  - hide 시 featuredOrder 자동 null
  - unhide는 PUBLIC/non-featured
  - reorder에 누락·중복·타 장소 ID 있으면 전체 rollback
  - version stale request는 409
  - 감사 로그에 actor/action/before/after, object key와 이메일 없음

### 3.2 GREEN — 공개 서비스 계약

- [ ] 다음 함수를 구현한다.

```ts
export async function setReviewPhotoVisibility(db: AppDb, input: {
  photoId: string;
  placeId: string;
  actorUserId: string;
  status: "PUBLIC" | "HIDDEN";
  expectedVersion: number;
  reason: string;
  now: string;
}): Promise<{ version: number }>;

export async function setReviewPhotoFeatured(db: AppDb, input: {
  photoId: string;
  placeId: string;
  actorUserId: string;
  featured: boolean;
  expectedVersion: number;
  now: string;
}): Promise<{ version: number; featuredOrder: number | null }>;

export async function reorderFeaturedReviewPhotos(db: AppDb, input: {
  placeId: string;
  actorUserId: string;
  orderedPhotoIds: string[];
  expectedVersions: Record<string, number>;
  now: string;
}): Promise<void>;
```

- [ ] `setFeatured(true)`는 현재 max order + 1을 사용하되 같은 D1 batch에서 count/availability를 조건부 검증한다.
- [ ] reorder는 먼저 기존 order를 임시 음수로 옮기지 않는다. 부분 unique 충돌을 피하도록 한 batch에서 order를 null로 clear한 뒤 1..N으로 conditional set하고 마지막 postcondition을 검증한다.
- [ ] `expectedVersion` 없는 mutation은 허용하지 않는다.

### 3.3 철회 연동

- [ ] 리뷰 철회 서비스 batch에서 해당 review photo moderation의 `featured_order=NULL`을 명시적으로 적용한다.
- [ ] public query가 review status로 이미 차단하더라도 운영 화면에 유령 featured count가 남지 않게 한다.
- [ ] 철회 rollback test에 moderation state도 함께 rollback되는지 추가한다.

### 3.4 검증·커밋

```bash
pnpm run test:integration -- tests/integration/reviewer-photo-curation-admin.test.ts tests/integration/reviewer-review-withdrawal.test.ts
pnpm run typecheck
git diff --check
```

- [ ] featured max/check/version guard를 임시 제거하는 mutation으로 테스트 민감도를 확인한다.

```bash
git add app/features/ratings/reviewer-photo-curation.server.ts app/db/schema.ts tests/integration/reviewer-photo-curation-admin.test.ts tests/integration/reviewer-review-withdrawal.test.ts
git commit -m "2026-08-14 관리자 리뷰 사진 공개와 대표 선정 서비스"
```

---

## Task 4. 관리자 장소별 사진 큐레이션 UI

**소유 파일**

- Create: `app/routes/admin-place-photos.tsx`
- Create: `app/components/admin/PlacePhotoCuration.tsx`
- Modify: `app/routes.ts`
- Modify: `app/routes/admin-places.tsx`
- Modify: `app/app.css`
- Create: `tests/e2e/admin-place-photo-curation.spec.ts`

### 4.1 RED — 역할·상호작용

- [ ] non-admin 403/redirect, ADMIN만 loader/action 사용 가능.
- [ ] 24장 페이지, `더 보기`, selected count `3 / 5` 표시.
- [ ] 대표 선정·해제, 공개 중단·복구, 순서 변경, stale version 409 inline message.
- [ ] 6번째 선정 버튼 비활성 + 서버 거부.
- [ ] 철회된 photo는 관리자 목록에서 `원본 철회`로 읽기 전용 또는 제외.
- [ ] keyboard로 선정 toggle과 순서 위/아래 조작 가능.

### 4.2 GREEN — route

- [ ] `/admin/places/:placeId/photos` route를 추가한다.
- [ ] loader는 place summary, current featured, paginated public/hidden photos와 moderation version을 반환한다.
- [ ] action은 Zod discriminated union을 사용한다.

```ts
type AdminPhotoIntent = "FEATURE" | "UNFEATURE" | "HIDE" | "RESTORE" | "REORDER";
```

- [ ] strict same-origin, ADMIN role, place/photo 관계를 검증한다.
- [ ] 예상 오류는 전체 ErrorBoundary가 아니라 fetcher JSON `400/409/503`으로 반환한다.

### 4.3 GREEN — UI

- [ ] 사진 카드에는 썸네일, 발행 월, PRIMARY/REVISIT, PUBLIC/HIDDEN, featured order만 표시한다. reviewer 이메일은 노출하지 않는다.
- [ ] 대표 선정은 checkbox가 아니라 명확한 toggle button과 `대표 2` badge로 표시한다.
- [ ] drag-only 정렬을 피하고 위/아래 button을 기본으로 제공한다. pointer drag는 선택적 향상으로만 둔다.
- [ ] 메인 비율 16:10 crop preview를 상단에 제공한다.
- [ ] public hide는 reason 5~200자 필수, feature에는 reason 불필요.
- [ ] pending은 해당 photo card만 잠그고 성공/실패 toast를 표시한다.

### 4.4 스타일·검증·커밋

- [ ] 기존 admin 디자인 토큰과 spacing scale을 사용하고 새 broad `article`, `button` selector를 만들지 않는다.

```bash
pnpm exec playwright test tests/e2e/admin-place-photo-curation.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

- [ ] 데스크톱·모바일 evidence를 남긴다.

```bash
git add app/routes/admin-place-photos.tsx app/components/admin/PlacePhotoCuration.tsx app/routes.ts app/routes/admin-places.tsx app/app.css tests/e2e/admin-place-photo-curation.spec.ts docs/evidence/2026-08-14-admin-photo-curation-desktop.png docs/evidence/2026-08-14-admin-photo-curation-mobile.png
git commit -m "2026-08-14 관리자 장소 사진 큐레이션 UI"
```

---

## Task 5. 장소 메인 대표 캐러셀

**소유 파일**

- Create: `app/components/places/PlacePhotoCarousel.tsx`
- Modify: `app/routes/place-detail.tsx`
- Modify: `app/app.css`
- Create: `tests/unit/place-photo-carousel-contract.test.tsx`
- Create: `tests/e2e/place-photo-carousel.spec.ts`

### 5.1 RED — 이미지 조합 순서

- [ ] loader contract를 먼저 작성한다.
  - heroImageUrl 존재 + featured 3 → 4장, hero first
  - hero 없음 + featured 3 → featured order 1 first
  - 같은 URL/photo duplicate 제거
  - 선정 0 + hero 없음 → FIELD NOTE fallback
  - WITHDRAWN/HIDDEN source는 들어오지 않음
- [ ] carousel interaction을 작성한다.
  - 자동 재생 없음
  - previous/next, indicator `1 / 4`
  - ArrowLeft/ArrowRight
  - 모바일 swipe threshold
  - prefers-reduced-motion
  - 첫 이미지 eager/high priority, 이후 lazy

### 5.2 GREEN — loader projection

- [ ] place detail loader가 `listFeaturedPlaceReviewPhotos`를 병렬 호출하고 다음 배열을 만든다.

```ts
type PlaceHeroSlide =
  | { kind: "LEGACY"; src: string; alt: string }
  | { kind: "REVIEWER"; photoId: string; src: string; alt: string };
```

- [ ] 기존 heroImageUrl을 기본 첫 장으로 유지한다.
- [ ] 향후 관리자가 review photo를 첫 장으로 승격하는 정책은 이번 PR에서 구현하지 않는다. 요구가 생기면 별도 `primary_source` 필드 설계가 필요하다.

### 5.3 GREEN — 캐러셀

- [ ] carousel state는 active index 하나만 둔다.
- [ ] 자동 interval, autoplay, 외부 carousel package를 추가하지 않는다.
- [ ] slide 변경은 transform 대신 단순 conditional/opacity로 구현하고 reduced-motion에서 transition을 제거한다.
- [ ] touch drag는 horizontal intent가 vertical scroll보다 명확할 때만 preventDefault 한다.
- [ ] controls 최소 44px, focus-visible, aria-label, `aria-live="polite"`를 제공한다.
- [ ] fallback은 기존 FIELD NOTE 디자인을 유지한다.

### 5.4 검증·커밋

```bash
pnpm test -- tests/unit/place-photo-carousel-contract.test.tsx
pnpm exec playwright test tests/e2e/place-photo-carousel.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add app/components/places/PlacePhotoCarousel.tsx app/routes/place-detail.tsx app/app.css tests/unit/place-photo-carousel-contract.test.tsx tests/e2e/place-photo-carousel.spec.ts
git commit -m "2026-08-14 장소 대표 리뷰 사진 캐러셀"
```

---

## Task 6. 모든 리뷰 사진 하단 갤러리와 더 보기

**소유 파일**

- Create: `app/routes/place-review-photos-resource.ts`
- Create: `app/components/places/PlaceReviewPhotoGallery.tsx`
- Modify: `app/routes.ts`
- Modify: `app/routes/place-detail.tsx`
- Modify: `app/app.css`
- Create: `tests/integration/place-review-photos-resource.test.ts`
- Create: `tests/e2e/place-review-photo-gallery.spec.ts`

### 6.1 RED — pagination·공개 경계

- [ ] first 12, next cursor, 마지막 null을 실제 D1에서 검증한다.
- [ ] 중간에 새 사진이 추가되어도 cursor 이후 중복·누락이 deterministic tie-break 규칙 안에서 없는지 작성한다.
- [ ] invalid/tampered cursor 400, 다른 place cursor 재사용 400.
- [ ] HIDDEN/WITHDRAWN photo가 first와 next page 모두에서 제외되는지 작성한다.

### 6.2 GREEN — resource route

- [ ] `/resources/places/:placeSlug/review-photos` GET route를 추가한다.
- [ ] public place slug를 resolve하고 `cursor`, `limit`을 Zod로 검증한다.
- [ ] response에는 id/url/reviewKind/publishedAt/position/nextCursor만 포함하고 reviewerUserId, objectKey를 포함하지 않는다.
- [ ] `Cache-Control: private, no-store`로 moderation 즉시성을 유지한다.

### 6.3 GREEN — 갤러리

- [ ] place detail initial loader는 first page만 제공한다.
- [ ] `PlaceReviewPhotoGallery`는 `useFetcher`로 next page를 이어 붙인다.
- [ ] 버튼 문구는 `사진 더 보기`, pending은 `불러오는 중…`, 끝나면 button을 제거한다.
- [ ] 사진 click은 큰 보기 dialog를 열고 이전/다음, Escape, focus trap, close button을 제공한다.
- [ ] dialog에 reviewer 개인정보·장문 리뷰를 표시하지 않는다.
- [ ] alt는 `${placeName} 리뷰 사진 · ${재방문 여부}`처럼 사실만 사용한다.

### 6.4 성능·검증·커밋

- [ ] initial 12 외 이미지는 요청되지 않는지 Playwright network count로 확인한다.
- [ ] img에 width/height 또는 aspect-ratio를 지정해 layout shift를 막는다.
- [ ] object URL이나 대용량 client cache를 만들지 않는다.

```bash
pnpm run test:integration -- tests/integration/place-review-photos-resource.test.ts
pnpm exec playwright test tests/e2e/place-review-photo-gallery.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add app/routes/place-review-photos-resource.ts app/components/places/PlaceReviewPhotoGallery.tsx app/routes.ts app/routes/place-detail.tsx app/app.css tests/integration/place-review-photos-resource.test.ts tests/e2e/place-review-photo-gallery.spec.ts
git commit -m "2026-08-14 장소 리뷰 사진 전체 갤러리"
```

---

## Task 7. 철회·공개 중단·캐시 정합성 end-to-end

**소유 파일**

- Modify: `tests/integration/reviewer-review-withdrawal.test.ts`
- Modify: `tests/integration/reviewer-photo-curation-admin.test.ts`
- Modify: `tests/e2e/place-photo-carousel.spec.ts`
- Modify: `tests/e2e/place-review-photo-gallery.spec.ts`
- Modify: `tests/e2e/admin-place-photo-curation.spec.ts`

### 7.1 실제 상태 전이 시뮬레이션

- [ ] 다음 sequence를 하나의 E2E fixture로 검증한다.

```text
리뷰어 사진 3장 발행
→ 갤러리 3장 공개
→ 관리자 2장 대표 선정
→ carousel 2장 반영
→ 1장 공개 중단
→ gallery 2장, carousel 1장
→ 원본 리뷰 철회
→ gallery 0장, carousel 0장, binary URL 404
```

- [ ] 브라우저 cache를 비우지 않고 같은 context에서 상태 전이가 반영되는지 확인한다.
- [ ] R2 delete가 실패해 cleanup pending이어도 binary route는 D1 status로 404를 반환하는지 확인한다.
- [ ] stale admin tab이 이전 version으로 feature할 때 409를 받고 공개 상태가 변하지 않는지 확인한다.

### 7.2 mutation proof

- [ ] public route의 review status filter 제거 → 철회 binary URL assertion 실패.
- [ ] moderation status filter 제거 → hidden gallery assertion 실패.
- [ ] featured max guard 제거 → sixth feature assertion 실패.
- [ ] 캐시 no-store 제거 → header contract 실패.
- [ ] 모두 즉시 원복하고 production diff가 의도한 상태인지 확인한다.

### 7.3 검증·커밋

```bash
pnpm run test:integration -- tests/integration/reviewer-review-withdrawal.test.ts tests/integration/reviewer-photo-curation-admin.test.ts tests/integration/reviewer-photo-route.test.ts
pnpm exec playwright test tests/e2e/place-photo-carousel.spec.ts tests/e2e/place-review-photo-gallery.spec.ts tests/e2e/admin-place-photo-curation.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
git diff --check
```

```bash
git add tests/integration/reviewer-review-withdrawal.test.ts tests/integration/reviewer-photo-curation-admin.test.ts tests/e2e/place-photo-carousel.spec.ts tests/e2e/place-review-photo-gallery.spec.ts tests/e2e/admin-place-photo-curation.spec.ts
git commit -m "2026-08-14 리뷰 사진 철회와 대표 노출 정합성 검증"
```

---

## Task 8. 전체 QA·비용 관측·운영 rollout

**소유 파일**

- Create: `docs/operations/reviewer-photo-curation-runbook.md`
- Modify: `README.md`
- Create: `docs/evidence/2026-08-14-place-photo-carousel-desktop.png`
- Create: `docs/evidence/2026-08-14-place-photo-gallery-mobile.png`

### 8.1 fresh 검증

```bash
pnpm test
pnpm run test:integration
pnpm exec playwright test tests/e2e/admin-place-photo-curation.spec.ts tests/e2e/place-photo-carousel.spec.ts tests/e2e/place-review-photo-gallery.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
pnpm run build
git diff --check
```

- [ ] migration 0000→0029와 0028→0029를 fresh D1에서 통과시킨다.
- [ ] desktop 1440px, tablet, mobile 390px에서 carousel crop·gallery layout·admin controls를 캡처한다.
- [ ] 키보드 전용, reduced motion, network 3G throttling, image 404 경로를 QA한다.
- [ ] 독립 코드 리뷰 Critical/Important 0건을 확인한다.

### 8.2 비용·관측 runbook

- [ ] binary route no-store 전환으로 R2 read가 늘어나는 영향을 계산한다.
  - initial gallery 최대 12
  - carousel 최대 6(legacy 1 + featured 5)
  - next page 사용자가 눌렀을 때만 최대 24
- [ ] 관측 항목: gallery page load, binary 404/503, feature 409, hidden count, cleanup pending, R2 GET volume.
- [ ] 비용 임계치를 넘으면 사진 수를 줄이지 않고 signed/versioned cache 설계를 별도 ADR로 검토한다. 이번 PR에서 새 캐시 계층을 추가하지 않는다.
- [ ] 운영자가 숨김/복구/대표 선정 시 입력해야 할 reason, 감사 조회, rollback을 문서화한다.

### 8.3 rollout

- [ ] 배포 순서:
  1. 0029 remote D1 migration
  2. Worker deploy with admin mutation flag off
  3. public query no-store smoke
  4. QA place 한 곳에서 admin curation flag on
  5. carousel/gallery 확인
  6. 전체 admin 활성화
- [ ] rollback:
  - admin flag off
  - carousel feature flag off → legacy hero만 사용
  - gallery는 기존 first 12 query로 축소 가능
  - 0029 table은 유지하고 forward repair

### 8.4 PR 승인 범위

- [ ] PR 본문에 0029 migration, R2 read 비용, no-store, target environment, test/evidence, remote operation, rollback을 명시한다.
- [ ] PR 병합 전 remote D1, deploy, 운영 사진 moderation을 실행하지 않는다.
- [ ] checks와 diff를 검수한 뒤 ready 전환한다.

```bash
git add docs/operations/reviewer-photo-curation-runbook.md README.md docs/evidence/2026-08-14-place-photo-carousel-desktop.png docs/evidence/2026-08-14-place-photo-gallery-mobile.png
git commit -m "2026-08-14 리뷰 사진 큐레이션 운영과 QA 문서"
```
