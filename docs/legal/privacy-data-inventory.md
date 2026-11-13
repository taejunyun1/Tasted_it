# Re:Taste 개인정보 데이터 인벤토리

기술 동작 대조일: 2026-11-13 — 병합 코드 `3bc7758`(#382, W04 #372 포함) 기준. 실제 운영 배포·migration 적용·정식 시행 완료를 뜻하지 않는다.
법률 문서 기준: `kimlawtech/korean-privacy-terms` commit `5aee07aad42d71a0716f3d1ed160197194a508a0`

| 데이터 | 목적 | 저장 위치 | 보유·삭제 기준 | 처리자/이전 |
|---|---|---|---|---|
| 이메일, 표시 이름, 역할 | 베타 계정 식별·권한 | Cloudflare D1 | 탈퇴 시 이메일은 `withdrawn.<id>@invalid.local`, 표시 이름은 일반 문구로 대체하고 비밀번호·연동·세션 등을 정리한다. `users` 행의 ID·역할과 리뷰·감사 관계키는 남는다. 자유 문안까지 완전 익명화하거나 전부 즉시 삭제하는 동작은 아님. 법정 보존·분리 보관의 확정 기준은 #360에서 검토 | Cloudflare |
| 불투명 회원 세션 ID, 생성·만료 시각 | 로그인 유지·보안 | 쿠키(HttpOnly)·D1 | 7일 또는 로그아웃/탈퇴 시 | Cloudflare |
| 무작위 비회원 취향 세션 ID, 단계·위치 사용 방식, 선택 배지, 생성·갱신·만료·완료·건너뛰기·병합 시각 | 가입 전 취향 복원·회원 병합·개인화 추천 | 쿠키(HttpOnly)·Cloudflare D1 | 진행 중에는 유효 활동 시점부터 30일. 완료·건너뛰기는 terminal 활동부터 30일로 고정하고 병합 상태도 연장하지 않음. 성공한 계정 연결은 임시 배지·저장을 같은 batch에서 정리하고 guest 쿠키를 만료한다. 계정 연결 batch가 반영되지 않은 경우 기존 만료 기한 안에서 원본·쿠키를 유지해 명시 재시도한다. 응답을 받지 못했다면 연결 상태를 다시 조회한다. 병합 표시 세션은 기존 만료까지 유지. 기존 daily cron이 만료 세션과 연결 배지·임시 저장을 cascade 삭제 | Cloudflare |
| 비회원 임시 저장의 세션 ID, 내부 장소 ID, 저장 시각 | 가입 전 장소 선택 유지·로그인 후 계정 연결 | D1 `guest_saved_places` | 세션당 최대50곳. 기존 guest 세션 최대30일 수명을 따르며 해제·성공 연결 시 삭제, 만료 세션 정리 시 cascade 삭제. 공개 반응·회원 저장과 구분 | Cloudflare |
| 추천·비추천 원본 이벤트·현재 투표: 회원/장소/이전 event ID, 값·이벤트 유형·생성 시각, 불변 `source`, `reviewId/reviewVersion` | 1인·1장소 현재 반응, 원본 이력·일반/검수 리뷰어 신호 구분, 다른 저자/장소/내용을 붙인 공개 방지 | D1 `vote_events`, `current_votes` | 원본 event는 UPDATE 금지이며 source·리뷰 결속을 역할 변경으로 재분류하지 않음. 공개는 현재 적격 projection만 사용. 본인 취소는 원본을 남기고 현재 표를 회수하며, 계정 탈퇴는 표시정보 대체 후 관계키·원본을 유지함. 리뷰어 신호의 승인/회수·활동/탈퇴 gate는 별도 적용. 확정 보유기간·추가 삭제 범위는 #360 검토 | Cloudflare |
| 저장 장소 | 개인 저장 기능 | D1 | 사용자가 해제하거나 탈퇴할 때 | Cloudflare |
| 계정의 명시 저장·해제 선택표식: 회원 ID, 내부 장소 ID, 선택 여부, 수정 시각 | guest 연결이 계정의 기존 명시 선택을 덮지 않게 함 | D1 `member_save_choices` | 새 명시 선택부터 기록하며 과거 absence를 해제로 추정하지 않음. 다음 명시 선택까지 유지하고 탈퇴 또는 계정 삭제 시 삭제 | Cloudflare |
| 임시 저장·연결 요청 제한용 IP의 용도 구분 SHA-256 hash, 시간창 시작, 요청 횟수 | 저장·연결 POST의 남용 방어 | 기존 D1 `rate_limit_windows` | 15분 창당120회 구현상 상한. 24시간이 지난 창을 이후 POST 또는 기존 일일 lifecycle에서 삭제. GET은 이 기록을 생성하지 않으며 원문 IP는 이 테이블에 저장하지 않음. 완전 익명화된 값이라고 간주하지 않음 | Cloudflare |
| 반올림 브라우저 위치(위도·경도 소수점 셋째 자리, 약 100m)와 bbox | 내 주변 온보딩 추천 | 브라우저 sessionStorage·추천 요청 URL query·브라우저 기록·Cloudflare 접근 로그 표면 | sessionStorage는 브라우저 탭 세션 종료 시 소멸. D1·제품 이벤트에는 저장하지 않음. URL/접근 로그는 Cloudflare 실제 로그 보존 설정의 적용을 받으므로 운영 설정 확정 필요 | Cloudflare, 지도 타일 요청 시 공급자가 IP 등 수신 가능 |
| 제품 이벤트의 무작위 이벤트 ID, 회원/비회원 참조, 이벤트 이름, 허용 metadata(`step`, `selectedCount`, `sourceRail`, `discoveryMode`, `reason`), 발생 시각 | 온보딩·추천 전환과 단기 출시 지표 | Cloudflare D1 | 발생 후 30일. 출시 직후·24시간 관찰과 월 단위 단기 비교를 위한 최소 운영 기간이며 daily cron 삭제 | Cloudflare |
| 접속·오류·보안 로그 | 장애 대응·보안 | Cloudflare observability | 실제 계정 설정에서 보존기간 확정 필요 | Cloudflare |
| 가입·재설정·정정 확인 메일 주소 | 본인 확인 메일 발송 | Resend | 메일 공급자 보존 정책. 토큰 해시는 D1에 30분 | Resend |
| Google·네이버 로그인 식별자·제공 이메일 | 소셜 로그인 | D1 `auth_identities` | 계정 존속 중. 연동 해제 또는 탈퇴 시 | Google, 네이버 |
| 비밀번호 해시·솔트 | 이메일 로그인 | D1 | 계정 존속 중. 재설정 시 교체. 탈퇴 시 null | Cloudflare |
| 리뷰어 신청 직업·소개 | 리뷰어 심사 | D1 | 신청 처리 또는 탈퇴 시 식별 문구를 제거 | Cloudflare |
| 리뷰어 방문 기록: 작성자·장소·분류 ID, 방문일(`visitedOn`)·방문 설명(`visitNote`)·이해관계 신고(`disclosure`), 평가·배지·사진 수·Golden 신청/설명, 제출/생성/갱신·공개 시각 | 방문 근거 확인·검수 요청·공개 평가와 사진의 대상 결속 | D1 `reviewer_visit_reviews` | 승인 전 비공개. 승인·활동·장소·권리 조건이 유지되는 현재 내용만 공개하며 방문 설명·내부 권리 설명은 공개 projection에 없음. 승인된 공개 프로필에는 장소·방문일·평가·배지·사진/설명을 연결할 수 있음. 기존 원본은 LEGACY_UNREVIEWED로 보존하며 자동 승인하지 않음. 본인 철회·탈퇴·관리자 회수는 공개를 차단하지만 방문 행과 자유 문안을 자동 삭제하지 않음. 확정 보유기간은 #360 검토 | Cloudflare |
| 사진 파일과 관리/권리 정보: 사진·review ID, 내용 version, 촬영일(`takenOn`), 권리 근거(`rightsBasis`: 직접 작업/허락)·권리 설명(`rightsNote`), 사진 설명(`caption`), 개인정보 확인(`privacyChecked`), 정확한 object key·JPEG 형식·크기·순서·생성/갱신 시각 | 직접 방문 사진 검수, 사용 권리·개인정보 확인, 승인된 사진 표시와 정확한 삭제 대상 식별 | D1 `reviewer_visit_photos`·R2 사진 객체 | 승인 전에는 본인/ADMIN의 인증된 preview만 허용. 공개 GET/HEAD도 승인·현재 내용/작성자·장소 적격성을 조회하며 no-store로 제공. 본인 철회·탈퇴는 정확한 key 목록을 저장해 파일 삭제를 시도하고 성공 후 해당 사진 metadata·photoCount/참조를 정리한다. 실패 중에는 삭제 대기를 보존해 재시도하며 재제출/승인을 차단. ADMIN의 공개 회수/보완/반려는 파일 보존. 사진 metadata를 지워도 아래 불변 audit 안에 이전 권리·설명·식별/객체 참조가 남을 수 있음. 별도 TTL 추가 없음 | Cloudflare |
| 현재 검수 상태와 결정: 상태·현재 여부, 내용/승인 내용 version, 수정 CAS version, 기반 vote event ID, 검수 actor·시각·사유·규칙 version·Golden event 연결 | 동일 작성자/장소의 현재 기록·검수 내용 식별, 오래된 승인/요청이 새 선택을 덮지 않게 함 | D1 `reviewer_visit_reviews` | 현재 결정 정보를 갱신하고 각 변경은 아래 불변 이력으로 남김. 탈퇴 시 이 행의 자유 문안·관계키를 일괄 제거하지 않음. 검수 담당자/사유와 방문 근거·권리 설명은 공개 projection에 포함하지 않음. 법정/업무 보유기간·추가 삭제 절차 미확정(#360) | Cloudflare |
| 제출·수정·검수·본인 철회 이력: transition/review ID, expected/to version, 작업, actor ID, 사유, before/after 상태·사진 metadata, 규칙 version·생성 시각 | 권한·동시 수정 검증과 결정 근거/권리 설명의 변경 이력 감사 | D1 `reviewer_review_transitions` | UPDATE/DELETE를 막는 불변 이력. 이전 방문/사진/권리 자유 문안, 검수 확인값과 소유/장소·사진 참조가 들어갈 수 있음. 계정 표시정보 대체·사진 파일/metadata 삭제 뒤에도 actor/reviewer 관계키 및 전후 상태가 남음. 자동 TTL/일괄 삭제 없음. 이를 익명 집계로 취급하지 않으며 보유기간·열람/정정/삭제 처리 범위는 #360 출시 전 검토 대상 | Cloudflare |
| 사진 정리 계획: review ID, ORPHAN/DELETE 목적, 정확한 object key 목록, 다음 시도 시각·횟수·생성/갱신 시각 | 응답 유실의 미참조 업로드 정리와 본인 철회/탈퇴 삭제 실패 재시도 | D1 `reviewer_photo_cleanup_jobs` | 성공한 계획을 정리하고 실패는 다음 재시도를 위해 유지. ORPHAN은 DB가 참조하는 사진을 삭제하지 않으며 DELETE는 본인 삭제 대상만 처리. 원본/계획 전체를 즉시 삭제하거나 완료한 것으로 간주하지 않음. 새 보관기간 설정 없음 | Cloudflare |
| 공개 유효성 counter·파생 결과의 결속값: 전역 moderation epoch, 장소 vote revision, rating snapshot의 epoch·vote revision, trust/similarity snapshot의 epoch, INFERRED 취향 evidence의 epoch·회원 taste version token | 승인·회수·source 적격성/현재 표 변경 뒤 낡은 공개 점수·신뢰 보정·추론 취향의 재사용 차단 | D1 `reviewer_publication_state`, `places`, 기존 rating/trust/similarity snapshot·`user_taste_badges`/`taste_learning_states` | 전역/장소 counter는 원본 방문 문안이 아닌 유효성 값. 회원별 파생 취향에는 기존 user ID 연결이 존재함. epoch/version 불일치 결과는 사용하지 않고 기존 경로로 재계산한다. 이 counter가 원본 삭제나 개인정보 익명화의 증거는 아니며 새 보존기간을 정하지 않음 | Cloudflare |


비회원 공개 열람은 허용하고 공개 추천·비추천과 회원의 영구 저장은 서버 로그인 조건을 유지한다. guest 쿠키는 암호학적 난수로 만든 불투명 ID이며 HttpOnly·SameSite=Lax, HTTPS에서는 Secure 속성을 사용한다. 쿠키 ID를 URL·요청 body에서 다른 세션의 소유권 증명으로 받지 않는다. 신규 HMAC 쿠키나 외부 추적 공급자를 추가하지 않았다.

현재 맞춤형 광고, 민감정보, 고유식별정보, 14세 미만 아동 대상 수집, 제3자 판매는 하지 않는다. 만 14세 미만은 가입을 받지 않으며 생년월일은 저장하지 않는다. 결제·이메일·분석·크래시 도구를 도입할 때 이 표와 처리방침을 같은 릴리스에서 갱신한다.

## 출시 차단 항목

- 운영자의 법적 명칭·주소 확정
- 개인정보 보호책임자 성명/직책/실제 이메일·전화 확정
- Cloudflare 계약 주체, 처리 위치, 국외 이전 국가·일시·방법·보유기간 확인


## 병합 구현 근거와 출시 전 확인 범위

- `app/features/onboarding/guest-session.server.ts`: 무작위 guest ID·쿠키·기존30일 수명.
- `app/features/onboarding/guest-saves.server.ts`, `app/routes/guest-saves-resource.ts`:50곳 상한, cookie 소유·POST 제한, GET 쓰기0.
- `app/features/onboarding/guest-merge.server.ts`: 회원의 기존 값 보존, 병합 batch 원자성과 성공 후 임시 원본 정리/쿠키 만료.
- `app/features/saves/save.server.ts`, `app/features/auth/account.server.ts`: 명시 선택표식과 탈퇴 삭제.
- `app/features/onboarding/data-lifecycle.server.ts`, `drizzle/0041_guest_saved_places.sql`: 만료·24시간 이전 창 정리와 FK cascade.

이 대조는 수집·보존 정책을 새로 정하지 않는다. 출시 차단 항목은 실제 입력과 운영 설정 확인 후 별도 PR로 닫는다. 리뷰어 수집·공개·삭제 경계는 #359 backend PR #382 병합 코드와 위 표를 대조했다. 실제 운영 migration·자료 검수·삭제 완료를 뜻하지 않는다. 법적 보유기간·문의처·국외 이전·추가 삭제 절차가 미확정인 #360은 OPEN이며, 출시 전 검토본 상태를 유지한다.


### 리뷰어 검수 구현 근거

- `app/db/schema.ts`, `drizzle/0040_reviewer_moderation.sql`: 수집 필드, 기존 원본 보존·source 동결, 불변 transition, 공개 counter/사진 정리 계획의 저장 구조.
- `app/features/ratings/reviewer-moderation.server.ts`, `reviewer-visit.server.ts`: 실제 방문/사진 권리 입력, 관리자 승인·수정 재심·소유자 철회, 전후 상태와 metadata 이력.
- `app/features/ratings/reviewer-publication.server.ts`, `reviewer-photo-access.server.ts`, `app/routes/reviewer-photo.ts`: 현재 승인·작성자/장소·사진 결속과 인증된 preview/public no-store 경계.
- `app/features/ratings/reviewer-photo-deletion.server.ts`, `app/features/auth/account.server.ts`: 계정 표시정보 대체·공개 회수와 정확-key 삭제 계획을 같이 기록하고, 저장소 실패는 재시도한다. review/transition 자유 문안과 관계키를 일괄 지우는 경로는 없음.
- `app/features/ratings/vote.server.ts`, `recompute.server.ts`, `reviewer-trust.server.ts`, `app/features/members/taste-publication.server.ts`: source 원본과 현재 공개/파생 결과를 구분하고 epoch/revision/version token으로 오래된 사용을 차단한다.
