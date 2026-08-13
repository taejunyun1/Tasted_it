# 리뷰어 사진 업로드 안정화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 임시저장 없이 리뷰 발행 시 사진을 안전하게 저장하고, 공개 리뷰에 표시하며, 성공·실패 토스트와 일관된 클릭 커서를 제공한다.

**Architecture:** React Router action이 multipart 요청을 검증하고 사진 저장 service에 전달한다. service는 R2 객체 쓰기와 D1 리뷰·사진 metadata batch를 조정하며 실패 시 보상 삭제한다. 공개 사진은 D1 발행 관계를 확인하는 resource route만 R2에서 읽는다. EXIF 장소 제안은 이 계획에서 제외하고 1차 안정화 이후 별도 PR로 진행한다.

**Tech Stack:** React 19, React Router 8 Framework Mode, Cloudflare Workers/R2/D1, Drizzle ORM, Zod, Vitest Workers pool, Playwright, semantic CSS/design tokens

## Global Constraints

- 최신 `origin/main`에서 만든 `codex/tj_reviewer-photo-upload` branch/worktree만 사용한다.
- Issue #93에 담당자·소유 파일·운영 영향을 최신화하고 모든 변경은 PR로 병합한다.
- 새 R2 binding·D1 migration·외부 저장소이므로 기술 거버넌스의 Product/Tech/Privacy/Operations 증거를 PR에 기록한다.
- 운영 R2 생성, remote D1 migration, production deploy는 이 계획에서 실행하지 않는다.
- 사진은 0–5장, 브라우저 처리 후 JPEG, 파일당 8MiB, 전체 25MiB로 제한한다.
- 원본 파일명·EXIF·GPS·로컬 경로·R2 object key를 D1 공개 데이터·로그·사용자 오류에 노출하지 않는다.
- 사진이 하나라도 실패하면 리뷰·평가 신호·Golden Pick을 발행하지 않는다.
- `REVIEW_PHOTO_UPLOAD_ENABLED=false`이면 사진 입력을 숨기거나 안전하게 거부하고 기존 사진 없는 리뷰 발행은 유지한다.
- EXIF 위치 제안 패키지·parser·endpoint는 이번 구현에 포함하지 않는다.
- 모든 production 변경은 실패하는 회귀 테스트를 먼저 확인한 뒤 최소 구현한다.

---

### Task 1: R2/D1 사진 저장 계약과 migration

**Files:**
- Modify: `app/db/schema.ts`
- Create: `drizzle/0026_reviewer_visit_photos.sql`
- Modify: `wrangler.jsonc`
- Modify: `.dev.vars.example`
- Modify: `app/cloudflare-env.d.ts`
- Modify: `tests/unit/schema-contract.test.ts`
- Create: `tests/integration/reviewer-photo-migration.test.ts`
- Create: `docs/decisions/2026-08-13-review-photo-r2.md`

**Interfaces:**
- Produces table `reviewerVisitPhotos` with `id`, `reviewId`, `objectKey`, `contentType`, `byteSize`, `position`, timestamps.
- Produces binding `REVIEW_PHOTOS: R2Bucket` and flag `REVIEW_PHOTO_UPLOAD_ENABLED`.
- `review_id` references `reviewer_visit_reviews.id` with `ON DELETE CASCADE`; `object_key` is unique; `(review_id, position)` is unique.

- [ ] **Step 1: Write RED schema and migration contract tests**

Assert schema export, FK, unique object key, ordered position constraint, full migration chain on fresh D1, reapply failure, and no modification of migrations `0000–0025`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm test -- tests/unit/schema-contract.test.ts
pnpm run test:integration -- tests/integration/reviewer-photo-migration.test.ts
```

Expected: failure because `reviewer_visit_photos`, migration `0026`, and R2 env contracts do not exist.

- [ ] **Step 3: Implement minimal schema, migration, binding, and ADR**

Use a new migration only. Configure local/preview binding without creating a production bucket. ADR must record owner, purpose, rejected no-storage/base64 alternatives, privacy lifecycle, estimated request/storage ceiling, kill switch, rollback, and deletion responsibility.

- [ ] **Step 4: Verify GREEN**

Run the two focused commands plus `pnpm run typecheck` and `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add app/db/schema.ts drizzle/0026_reviewer_visit_photos.sql wrangler.jsonc .dev.vars.example app/cloudflare-env.d.ts tests/unit/schema-contract.test.ts tests/integration/reviewer-photo-migration.test.ts docs/decisions/2026-08-13-review-photo-r2.md
git commit -m "2026-08-13 리뷰 사진 저장 계약 추가"
```

---

### Task 2: 사진 검증과 R2 adapter

**Files:**
- Create: `app/features/ratings/reviewer-photo.ts`
- Create: `app/features/ratings/reviewer-photo.server.ts`
- Create: `tests/unit/reviewer-photo.test.ts`
- Create: `tests/integration/reviewer-photo.server.test.ts`

**Interfaces:**
- Produces `parseReviewerPhotoFiles(form: FormData): Promise<ValidatedReviewerPhoto[]>`.
- `ValidatedReviewerPhoto` contains only `{ id, bytes, contentType: "image/jpeg", byteSize, position }`.
- Produces `storeReviewerPhotos(bucket, input)` and `deleteReviewerPhotoObjects(bucket, keys)` with internal codes `PHOTO_STORAGE_FAILED` and `PHOTO_CLEANUP_FAILED`.
- Uses key `reviews/{reviewId}/{photoId}.jpg`; keys never enter logs or client errors.

- [ ] **Step 1: Write RED validation tests**

Cover 0–5 valid JPEGs, sixth file, non-JPEG, MIME spoof with wrong magic bytes, zero bytes, per-file 8MiB, total 25MiB, duplicate positions, and unknown multipart photo field.

- [ ] **Step 2: Verify RED**

```bash
pnpm test -- tests/unit/reviewer-photo.test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement pure validation**

Validate count before reading all bytes, bounded `arrayBuffer()`, JPEG SOI/EOI magic, normalized content type, safe opaque IDs, and strict error-code mapping.

- [ ] **Step 4: Write and verify RED R2 adapter tests**

Use local Miniflare R2. Verify exact metadata, immutable object bytes, no filename metadata, second-put failure cleanup, delete idempotency, and sanitized logs.

- [ ] **Step 5: Implement adapter and verify GREEN**

Run unit/integration tests, typecheck, and diff-check.

- [ ] **Step 6: Commit**

```bash
git add app/features/ratings/reviewer-photo.ts app/features/ratings/reviewer-photo.server.ts tests/unit/reviewer-photo.test.ts tests/integration/reviewer-photo.server.test.ts
git commit -m "2026-08-13 리뷰 사진 검증과 저장 어댑터 추가"
```

---

### Task 3: 리뷰·사진 일관 발행과 보상 삭제

**Files:**
- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Modify: `tests/integration/reviewer-visit.server.test.ts`
- Create: `tests/integration/reviewer-visit-photo-publish.test.ts`

**Interfaces:**
- Extend publish input with `photos: ValidatedReviewerPhoto[]` and `photoBucket: R2Bucket | null`.
- `publishReviewerVisitWithPhotos` returns review plus public photo IDs, never object keys.
- D1 batch inserts review, photo rows, vote/golden event, and reviewer activity together.

- [ ] **Step 1: Write RED transactional tests**

Cover no-photo backward compatibility, 1/5 photos, R2 put failure before D1, second-object failure cleanup, D1 trigger failure cleanup, photo row count equals review `photoCount`, duplicate review ID, Golden Pick requiring durable photo, and flag-off rejection when files exist.

- [ ] **Step 2: Verify RED**

```bash
pnpm run test:integration -- tests/integration/reviewer-visit.server.test.ts tests/integration/reviewer-visit-photo-publish.test.ts
```

Expected: photo APIs and metadata batch absent.

- [ ] **Step 3: Implement minimal orchestration**

Perform validation → R2 puts → one D1 batch. On any put or D1 failure, delete every successfully written key. Preserve current rating-stale behavior only after D1 publish succeeds. Do not downgrade a failed photo review into a photo-less review.

- [ ] **Step 4: Verify GREEN and mutation sensitivity**

Temporarily remove compensation and photo-count equality guards one at a time; confirm focused tests fail, then restore production code.

- [ ] **Step 5: Commit**

```bash
git add app/features/ratings/reviewer-visit.server.ts tests/integration/reviewer-visit.server.test.ts tests/integration/reviewer-visit-photo-publish.test.ts
git commit -m "2026-08-13 리뷰와 사진 원자 발행 연결"
```

---

### Task 4: 공개 사진 resource와 사용자 표시

**Files:**
- Create: `app/routes/reviewer-photo.ts`
- Modify: `app/routes.ts`
- Modify: `app/features/ratings/reviewer-visit.server.ts`
- Modify: `app/components/reviewer-visit-flow.tsx`
- Modify: `app/routes/place-detail.tsx`
- Create: `tests/integration/reviewer-photo-route.test.ts`
- Modify: `tests/integration/reviewer-visit.server.test.ts`
- Modify: `tests/unit/reviewer-visit-components.test.ts`
- Modify: `tests/unit/place-detail-route.test.ts`

**Interfaces:**
- Resource path `/review-photos/:photoId` accepts GET/HEAD only.
- It returns a photo only when D1 joins the photo to a published review; response includes JPEG content type, `nosniff`, `public, max-age=3600, s-maxage=86400`, and ETag. Do not use `immutable` so deletion converges.
- History DTO gains `photos: Array<{ id: string; url: string }>`.
- Produces `listPublishedPlaceReviewPhotos(db, placeId, limit)` returning public review metadata and opaque photo URLs for the place-detail loader.

- [ ] **Step 1: Write RED route tests**

Cover published photo GET/HEAD, unknown ID 404, row without review 404, non-GET 405, no object-key disclosure, cache/content headers, and R2 missing object safe 404/503 mapping.

- [ ] **Step 2: Verify RED**

Run the new Workers integration test and confirm the route is absent.

- [ ] **Step 3: Implement minimal resource and history projection**

Query D1 by opaque photo ID, read exact key server-side, and stream bytes. Add the exact route declaration:

```ts
route("review-photos/:photoId", "routes/reviewer-photo.ts"),
```

Project only `{ id, url }` to clients. Never return `objectKey`. Render thumbnails with empty decorative alt only when adjacent review/place text identifies the image; otherwise use `${place.name} 리뷰 사진`.

- [ ] **Step 4: Write RED component tests and implement display**

Assert public URLs appear, object keys do not, reviewer history handles 0–5 photos, and the public place-detail page renders the latest published review photos for signed-out users. Verify no unpublished/orphan photo appears and layout remains valid on mobile.

- [ ] **Step 5: Verify and commit**

```bash
git add app/routes/reviewer-photo.ts app/routes.ts app/features/ratings/reviewer-visit.server.ts app/components/reviewer-visit-flow.tsx app/routes/place-detail.tsx tests/integration/reviewer-photo-route.test.ts tests/integration/reviewer-visit.server.test.ts tests/unit/reviewer-visit-components.test.ts tests/unit/place-detail-route.test.ts
git commit -m "2026-08-13 발행 리뷰 사진 공개 표시"
```

---

### Task 5: 브라우저 이미지 처리·발행 action·토스트

**Files:**
- Create: `app/features/ratings/reviewer-photo.client.ts`
- Create: `app/components/app-toast.tsx`
- Modify: `app/components/reviewer-visit-flow.tsx`
- Modify: `app/routes/reviewer-ratings.tsx`
- Modify: `app/features/ratings/reviewer-visit.ts`
- Modify: `app/app.css`
- Create: `tests/unit/reviewer-photo-client.test.ts`
- Modify: `tests/unit/reviewer-visit.test.ts`
- Modify: `tests/unit/reviewer-visit-components.test.ts`
- Create: `tests/e2e/reviewer-photo-upload.spec.ts`
- Add safe fixtures under: `tests/fixtures/reviewer-photos/`

**Interfaces:**
- `prepareReviewerPhotos(files)` returns sanitized JPEG `File[]` plus preview URLs or a bounded public error code.
- Route action returns/redirects with allowlisted result only; no filenames/keys/stacks.
- Toast component accepts `{ kind: "success" | "error" | "info"; message: string }`, renders status/alert, and has close control.

- [ ] **Step 1: Write RED client preprocessing tests**

Test maximum 2,000px resize, JPEG quality path, metadata-free output fixture, unsupported decode, count/size errors, preview URL revoke, and no EXIF/GPS bytes retained.

- [ ] **Step 2: Verify RED and implement preprocessing**

Use browser-native `createImageBitmap`, canvas, and `toBlob`; no image-processing dependency. EXIF coordinates are neither parsed nor used.

- [ ] **Step 3: Write RED route/action tests**

Assert multipart parsing, same-origin, REVIEWER role, strict fields, success redirect/result, known errors mapped to 400/413/503, input retention on failure, and double-submit protection.

- [ ] **Step 4: Implement fetcher flow and toast**

Use React Router `useFetcher`; keep selected `File` objects in component state, submit a constructed `FormData` only at final publish, disable controls while non-idle, retain draft on failure, clear/revoke on success. Display both a toast and persistent inline error summary.

- [ ] **Step 5: Add cursor/accessibility CSS RED contracts and implementation**

Assert active semantic buttons, clickable photo label/chips use `cursor:pointer`; disabled controls use `cursor:not-allowed`; focus-visible, 44px targets, reduced motion, and mobile toast placement remain.

- [ ] **Step 6: Implement behavioral Playwright QA**

Using local R2/D1 only, cover desktop and mobile:

1. select actual JPEG fixture → preview → publish → success toast → public image loads;
2. unsupported/oversize → error toast and form retained;
3. injected R2 failure → no review, failure toast, retry succeeds;
4. double click → one review, pending message and disabled button;
5. computed cursor pointer/not-allowed;
6. keyboard and status/alert accessibility.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test -- tests/unit/reviewer-photo-client.test.ts tests/unit/reviewer-visit.test.ts tests/unit/reviewer-visit-components.test.ts
pnpm run test:integration -- tests/integration/reviewer-visit-photo-publish.test.ts tests/integration/reviewer-photo-route.test.ts
pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts
pnpm run typecheck
git diff --check
git add app/features/ratings/reviewer-photo.client.ts app/components/app-toast.tsx app/components/reviewer-visit-flow.tsx app/routes/reviewer-ratings.tsx app/features/ratings/reviewer-visit.ts app/app.css tests/unit/reviewer-photo-client.test.ts tests/unit/reviewer-visit.test.ts tests/unit/reviewer-visit-components.test.ts tests/e2e/reviewer-photo-upload.spec.ts tests/fixtures/reviewer-photos
git commit -m "2026-08-13 리뷰 사진 업로드 토스트와 UX 완성"
```

---

### Task 6: 삭제 경계·운영 문서·최종 검증

**Files:**
- Create: `app/features/ratings/reviewer-photo-deletion.server.ts`
- Create: `tests/integration/reviewer-photo-deletion.test.ts`
- Create: `docs/operations/reviewer-photo-storage.md`
- Modify: `README.md`
- Update: GitHub Issue #93 and PR body

**Interfaces:**
- Produces `deletePublishedReviewerVisitPhotos(db, bucket, reviewId)` for a future review/account deletion caller.
- Deletion is idempotent, bounded, logs only counts/error kinds, and does not delete unrelated keys.

- [ ] **Step 1: Record the current lifecycle boundary**

The repository currently has no implemented account-withdrawal or reviewer-review deletion service. Record that fact in Issue #93 and the operations runbook. Create only `reviewer-photo-deletion.server.ts`; do not add account UI or pretend that an absent lifecycle is integrated.

- [ ] **Step 2: Write RED deletion tests**

Cover one review deletion, all reviews for a supplied reviewer ID, missing R2 object, partial delete failure, retry, metadata/object agreement, empty review, and unrelated object preservation. The reviewer-wide helper must query bounded pages of exact metadata keys and must not list the bucket.

- [ ] **Step 3: Implement deletion boundary and run GREEN**

Do not perform unbounded bucket listing. Read exact keys from D1 metadata in pages of at most 100, delete those R2 objects, and delete photo rows only after all objects in the page are absent. Expose both functions:

```ts
deletePublishedReviewerVisitPhotos(db, bucket, reviewId): Promise<{ deleted: number }>
deleteReviewerPhotoObjectsForUser(db, bucket, reviewerUserId): Promise<{ deleted: number }>
```

The future account-deletion implementation must call the reviewer-wide function before deleting the user. This PR documents that requirement but does not add the missing account lifecycle.

- [ ] **Step 4: Write operations runbook**

Document bucket setup commands without credentials, local/preview/production isolation, flag rollout, quota/cost ceiling, object count/bytes metrics, error alerts, cleanup reconciliation, privacy/deletion SLA, migration order, rollback, and known limitation that EXIF place suggestions are Phase 2.

- [ ] **Step 5: Run final verification**

```bash
pnpm test
pnpm run test:integration
pnpm run typecheck
pnpm run build
pnpm exec playwright test tests/e2e/reviewer-photo-upload.spec.ts
git diff --check
git status --short
```

Classify any pre-existing baseline failure separately with reproduction evidence. Do not call production R2 or remote D1.

- [ ] **Step 6: Independent privacy/security/atomicity review**

Review object-key privacy, EXIF removal, auth/same-origin, multipart bounds, R2/D1 compensation, cache headers, deletion, cost ceiling, kill switch, UI failure recovery, and desktop/mobile visual evidence. Fix all blockers and rerun focused tests.

- [ ] **Step 7: Commit, push, and open PR**

```bash
git add app/features/ratings/reviewer-photo-deletion.server.ts docs/operations/reviewer-photo-storage.md README.md tests/integration/reviewer-photo-deletion.test.ts
git commit -m "2026-08-13 리뷰 사진 운영과 삭제 절차 정리"
git fetch origin main
git merge --no-edit origin/main
git push -u origin codex/tj_reviewer-photo-upload
gh pr create --base main --head codex/tj_reviewer-photo-upload
```

PR must include Issue #93, migration `0026`, R2 binding and bucket creation as a post-merge operator step, privacy/cost/rollback evidence, flag default, tests, desktop/mobile screenshots, and explicit statement that EXIF place suggestion is not implemented.

---

## Phase 2 Follow-up: EXIF 장소 제안

1차 PR이 병합되고 업로드 성공률·실패율·평균 파일 크기·공개 이미지 표시 QA가 안정화된 뒤 별도 Issue/spec/PR로 진행한다.

- 브라우저에서 GPS만 읽고 서버·D1·로그에 저장하지 않는다.
- `여기가 맞나요?` 후보 최대 3곳만 제안하며 사용자가 직접 확정한다.
- GPS 없는 사진은 기존 장소 검색으로 조용히 fallback한다.
- EXIF parser의 실제 gzip 증가량, 지원 형식, 위치 보유 사진 비율을 먼저 측정한다.
- 측정 결과 대비 가치가 낮으면 구현하지 않는다.
