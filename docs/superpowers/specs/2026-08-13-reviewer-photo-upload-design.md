# 리뷰어 사진 업로드·토스트 설계

- 상태: 구현 제안 — PR 병합 시 승인
- 작성일: 2026-08-13
- 담당: taejun-yun / Codex
- 추적: GitHub Issue #93

## 1. 문제와 목표

현재 리뷰어 방문 리뷰의 사진 단계는 선택한 파일명을 브라우저 상태에만 표시한다. 파일은 서버로 전송되지 않고, 리뷰 발행 시 `publishedPhotoCount`도 항상 0으로 저장된다. 화면의 “사진 저장 기능 준비 중” 문구는 이 제한을 그대로 드러내며 성공·실패 피드백도 없다.

이번 변경의 목표는 다음과 같다.

1. 리뷰 발행 버튼을 누를 때 선택한 사진과 리뷰를 함께 제출한다.
2. 사진 저장이 모두 성공한 경우에만 리뷰를 발행한다.
3. 발행된 사진은 모든 사용자에게 공개한다.
4. 성공·실패 결과를 명확한 토스트와 스크린리더 알림으로 제공한다.
5. 버튼과 클릭 가능한 UI는 마우스에서 손 모양 커서를 표시하고, 비활성 상태는 구분한다.
6. 실제 데스크톱·모바일 QA로 사용자에게 사진과 토스트가 보이는지 검증한다.

## 1.1 단계 구분

### 1차: 업로드 안정화 — 이번 구현 범위

- 최종 리뷰 발행 시 사진 업로드
- R2 객체와 D1 사진 메타데이터의 일관성
- 발행 사진의 공개 표시
- 성공·실패 토스트와 재시도
- 파일 검증·EXIF 제거·삭제 경계
- 버튼·사진 선택 영역의 cursor 및 접근성
- 로컬 R2/D1과 데스크톱·모바일 실제 QA

### 2차: EXIF 장소 제안 — 후속 별도 PR

사진 GPS를 읽어 `여기가 맞나요?` 후보를 제안하는 기능은 1차에서 구현하지 않는다. 업로드 안정화 수용 기준을 모두 통과한 뒤 다음 조건으로 별도 설계·PR을 진행한다.

- EXIF 파싱은 사진 선택 시 브라우저에서만 실행한다.
- 위치는 장소 자동 확정이 아니라 최대 3곳의 후보 제안에만 사용한다.
- 사용자가 후보를 눌러야 장소 선택이 바뀐다.
- 좌표를 D1·로그·사진 객체 metadata에 저장하지 않는다.
- GPS가 없거나 후보 신뢰도가 낮으면 기존 검색을 그대로 유지한다.
- 새 EXIF 의존성의 browser gzip 증가량과 실제 위치 보유 사진 비율을 측정한 뒤 도입 여부를 결정한다.
- 1차 코드에는 EXIF 패키지, GPS parser, 위치 후보 endpoint를 미리 넣지 않는다.

## 2. 검토한 접근

### A. 사진 선택 즉시 임시 업로드

선택 직후 비공개 객체를 만들고 리뷰 발행 시 공개로 전환한다. 즉시 업로드 상태를 보여주기 쉽지만, 미발행 객체의 만료·청소·복원과 개인정보 보존 정책이 추가된다.

### B. 리뷰 발행 시 사진과 리뷰를 함께 처리 — 채택

선택 단계에서는 기기 미리보기만 제공하고, 최종 발행 시 사진을 전송한다. 별도의 사용자 임시저장 기능이 없고 보존 정책이 단순하다. 실패하면 리뷰를 발행하지 않고 사용자가 같은 화면에서 다시 시도한다.

### C. 사진과 리뷰를 서로 독립적으로 발행

구현은 단순하지만 사진만 존재하거나 리뷰의 사진 수와 실제 객체가 다른 상태가 생길 수 있어 제외한다.

## 3. 사용자 흐름

1. 리뷰어가 최대 5장의 사진을 선택한다.
2. 브라우저는 파일을 디코딩하고 최대 2,000px, JPEG 품질 0.85로 재인코딩한다. 이 과정에서 EXIF 위치·기기 메타데이터를 제거한다.
3. 지원 형식이 아니거나 디코딩할 수 없거나 장수·용량 제한을 넘으면 서버 전송 전에 오류 토스트를 표시한다.
4. 리뷰어가 `리뷰 발행`을 누르면 React Router `fetcher.Form`이 리뷰 필드와 처리된 사진을 `multipart/form-data`로 한 번 제출한다.
5. 서버는 인증·REVIEWER 권한·same-origin, 필드 allowlist, 파일 수, MIME, magic bytes, 파일별·전체 크기를 다시 검증한다.
6. 서버는 R2에 사진을 저장한 뒤 D1 batch로 리뷰·사진 메타데이터·평가 신호를 발행한다.
7. R2 저장 중 하나라도 실패하면 앞서 저장한 객체를 best-effort 삭제하고 D1 리뷰를 만들지 않는다.
8. D1 발행이 실패하면 저장한 R2 객체를 best-effort 삭제하고 실패 응답을 반환한다. 삭제 실패는 객체 key가 아닌 제한된 오류 코드만 기록하며 운영 정리 대상으로 남긴다.
9. 성공하면 `사진과 리뷰를 발행했어요` 토스트를 표시하고 해당 리뷰로 이동한다. 사진이 없으면 `리뷰를 발행했어요`로 표시한다.
10. 실패하면 현재 입력과 선택 사진을 유지하고 원인별 토스트를 표시해 재시도할 수 있게 한다.

사용자가 별도로 관리하는 임시저장 기능은 두지 않는다. 발행 요청 내부에서 생성된 객체는 D1 commit 전 공개 조회에 노출되지 않는다.

## 4. 저장 구조와 공개 범위

### 4.1 Cloudflare R2

- binding: `REVIEW_PHOTOS`
- 운영 bucket 이름과 preview/local bucket은 분리한다.
- 객체 key는 추측하기 어려운 UUID 기반 `reviews/{reviewId}/{photoId}.jpg`를 사용한다.
- R2 public bucket URL은 사용하지 않는다.
- 공개 사진은 앱의 resource route가 D1의 발행 메타데이터를 확인한 뒤 R2 객체를 반환한다.
- 응답은 `Content-Type`, ETag, `nosniff`를 제공하고 `public, max-age=3600, s-maxage=86400`으로 제한한다. 삭제된 사진이 장기간 브라우저 cache에 남지 않도록 `immutable`은 사용하지 않으며 사용자 파일명을 header에 반영하지 않는다.

### 4.2 D1 메타데이터

새 `reviewer_visit_photos` 테이블을 순차 migration `0026`으로 추가한다.

- `id`: 사진 UUID
- `review_id`: `reviewer_visit_reviews.id` FK, 리뷰 삭제 시 cascade
- `object_key`: R2 key, unique
- `content_type`: 정규화된 `image/jpeg`
- `byte_size`: 저장된 바이트 수
- `position`: 0–4 정렬 순서
- `created_at`, `updated_at`

리뷰의 `photo_count`는 삽입할 사진 메타데이터 수와 항상 같아야 한다. 리뷰 조회는 사진 resource URL 목록을 함께 제공한다.

### 4.3 보존과 삭제

- 발행된 사진은 리뷰가 존재하는 동안 보존한다.
- 리뷰 또는 계정 삭제 서비스는 D1 메타데이터를 기준으로 R2 객체를 먼저 삭제하고, 실패 시 재시도 가능한 운영 오류를 남긴다.
- 이번 PR은 기존 리뷰 삭제 UI를 새로 만들지 않지만 삭제 service 경계를 제공하고 계약 테스트를 포함한다.
- 원본 파일명, EXIF, GPS, 사용자 로컬 경로는 D1·로그·응답에 저장하지 않는다.

## 5. 검증 제한

- 장수: 0–5장
- 입력 형식: JPEG, PNG, WebP를 브라우저에서 디코딩한 뒤 JPEG로 재인코딩
- 출력 형식: `image/jpeg`
- 출력 최대 변: 2,000px
- 파일별 최대 크기: 8MiB
- 요청 전체 사진 최대 크기: 25MiB
- SVG, GIF, HEIC 원본 직접 저장은 금지한다.
- 서버는 `File.type`만 신뢰하지 않고 JPEG magic bytes와 실제 크기를 확인한다.

브라우저에서 디코딩하지 못한 HEIC 등은 “이 사진 형식은 지원하지 않아요. JPEG·PNG·WebP로 다시 선택해 주세요”로 안내한다.

## 6. 오류와 토스트

토스트는 앱 전역 디자인 토큰을 사용한 우측 상단/모바일 하단 고정 알림이며 `role=status` 또는 오류 시 `role=alert`를 사용한다. 자동으로 닫히되 닫기 버튼을 제공하고, reduced motion을 존중한다.

| 상황 | 상태 | 문구 |
|---|---:|---|
| 사진 포함 발행 성공 | success | 사진과 리뷰를 발행했어요 |
| 사진 없는 발행 성공 | success | 리뷰를 발행했어요 |
| 디코딩·형식 실패 | error | 이 사진 형식은 지원하지 않아요 |
| 파일별·전체 용량 초과 | error | 사진 용량이 너무 커요 |
| 5장 초과 | error | 사진은 최대 5장까지 올릴 수 있어요 |
| R2 저장 실패 | error | 사진 업로드에 실패했어요. 다시 시도해 주세요 |
| 리뷰 발행 실패 | error | 리뷰를 발행하지 못했어요. 입력 내용을 확인해 주세요 |
| 중복 제출 | info | 리뷰를 발행하고 있어요 |

오류 응답은 안전한 코드와 사용자 문구만 반환하고 R2 key, stack, 원본 파일명, 공급자 응답을 노출하지 않는다.

## 7. 클릭 커서와 접근성

- 전역 semantic `button`, 활성 `label` 사진 선택 영역, 명시적 `[role="button"]`에 `cursor: pointer`를 적용한다.
- `button:disabled`, `aria-disabled=true`는 `cursor: not-allowed`로 표시한다.
- 링크는 브라우저 기본 pointer를 유지한다.
- 44px 터치 목표, 기존 focus-visible outline, 키보드 제출을 유지한다.
- 업로드 중 제출 버튼을 비활성화하고 `사진과 리뷰 발행 중…`을 표시한다.
- 토스트 외에도 form 내부 오류 요약을 유지해 토스트가 사라져도 복구 방법을 알 수 있게 한다.

## 8. 컴포넌트와 경계

1. `ReviewerVisitFlow`: 파일 선택, 브라우저 재인코딩, 미리보기 URL 수명, fetcher 제출, pending·toast 상태
2. reviewer route action: 인증·same-origin·multipart parsing·HTTP 오류 변환
3. photo validation module: count/size/magic-byte allowlist
4. R2 adapter: put/get/delete만 담당하며 제한된 내부 오류로 변환
5. publish service: R2 업로드 보상 삭제와 D1 review/photo batch 조정
6. photo resource route: 발행된 D1 photo id만 공개 반환

React component가 R2 binding이나 object key를 직접 알지 않도록 한다.

## 9. 운영·비용·롤백

R2는 현재 기술 거버넌스상 HOLD인 새 저장소이므로 이 PR은 ADR 성격의 결정 문서와 다음 증거를 포함한다.

- local/staging/production binding 분리
- 월 저장량·Class A/B 요청 예상과 비용 상한
- 파일·요청 상한과 abuse 방어
- 개인정보 최소화와 삭제 경로
- R2 장애 시 사진 없는 리뷰로 자동 강등하지 않고 명시적 실패
- kill switch `REVIEW_PHOTO_UPLOAD_ENABLED=false`
- rollback 시 업로드 UI를 숨기고 기존 공개 사진 resource는 읽기 전용 유지

운영 bucket 생성, remote D1 migration, secret/binding 반영, production deploy는 PR 병합과 운영 담당자 실행 전에는 수행하지 않는다.

## 10. 테스트와 실제 QA

### 단위

- 이미지 장수·크기·MIME·magic bytes
- 브라우저 전처리 실패 문구 매핑
- 토스트 성공·오류·닫기·aria role
- 클릭 가능/disabled 커서 계약

### Workers/D1 통합

- 0장 및 1–5장 발행
- R2 두 번째 객체 실패 시 첫 객체 삭제·D1 review 미생성
- D1 실패 시 모든 R2 객체 보상 삭제
- 사진 metadata 수와 review photo_count 일치
- 비리뷰어·cross-origin·unknown field·oversize 거부
- 공개 route는 발행 사진만 반환

### Playwright 데스크톱·모바일

- 실제 이미지 fixture 선택 → 미리보기 → 발행 → 성공 토스트 → 공개 이미지 표시
- 지원하지 않는 파일·초과 크기 → 오류 토스트와 입력 유지
- 서버 업로드 실패 fixture → 실패 토스트, 리뷰 미발행, 재시도 성공
- 중복 클릭 방지와 pending 문구
- 마우스 환경에서 버튼 computed cursor가 `pointer`, disabled가 `not-allowed`
- 스크린리더용 status/alert와 키보드 포커스

실제 운영 R2를 호출하지 않고 Miniflare R2 binding으로 반복 QA한다. PR에는 데스크톱·모바일 화면 증거와 검증 명령을 첨부한다.

## 11. 수용 기준

- 선택 사진이 최종 발행 시 실제 저장되고 공개 리뷰에서 보인다.
- 사진 실패 시 리뷰·평가 신호·Golden Pick이 생성되지 않는다.
- 성공·실패 토스트가 사용자와 보조기술에 전달된다.
- 입력은 실패 후 유지되고 재시도할 수 있다.
- 버튼·선택 영역의 cursor 상태가 일관된다.
- 원본 파일명·EXIF·GPS·R2 key가 공개 데이터와 로그에 노출되지 않는다.
- 새 binding·migration·비용·삭제·rollback이 PR에 명시되고 병합 전 운영 변경은 없다.
