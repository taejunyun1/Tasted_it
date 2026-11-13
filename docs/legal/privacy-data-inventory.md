# Re:Taste 개인정보 데이터 인벤토리

기술 동작 대조일: 2026-11-13 — 병합 코드 `b469063`(#372) 기준. 실제 운영 배포·migration 적용·정식 시행 완료를 뜻하지 않는다.
법률 문서 기준: `kimlawtech/korean-privacy-terms` commit `5aee07aad42d71a0716f3d1ed160197194a508a0`

| 데이터 | 목적 | 저장 위치 | 보유·삭제 기준 | 처리자/이전 |
|---|---|---|---|---|
| 이메일, 표시 이름, 역할 | 베타 계정 식별·권한 | Cloudflare D1 | 탈퇴 시 이메일은 `withdrawn.<id>@invalid.local`, 표시 이름은 일반 문구로 익명화. 역할 행은 투표 FK 때문에 유지. 분쟁·법령상 보존이 필요한 기록은 분리 보관 | Cloudflare |
| 불투명 회원 세션 ID, 생성·만료 시각 | 로그인 유지·보안 | 쿠키(HttpOnly)·D1 | 7일 또는 로그아웃/탈퇴 시 | Cloudflare |
| 무작위 비회원 취향 세션 ID, 단계·위치 사용 방식, 선택 배지, 생성·갱신·만료·완료·건너뛰기·병합 시각 | 가입 전 취향 복원·회원 병합·개인화 추천 | 쿠키(HttpOnly)·Cloudflare D1 | 진행 중에는 유효 활동 시점부터 30일. 완료·건너뛰기는 terminal 활동부터 30일로 고정하고 병합 상태도 연장하지 않음. 성공한 계정 연결은 임시 배지·저장을 같은 batch에서 정리하고 guest 쿠키를 만료한다. 계정 연결 batch가 반영되지 않은 경우 기존 만료 기한 안에서 원본·쿠키를 유지해 명시 재시도한다. 응답을 받지 못했다면 연결 상태를 다시 조회한다. 병합 표시 세션은 기존 만료까지 유지. 기존 daily cron이 만료 세션과 연결 배지·임시 저장을 cascade 삭제 | Cloudflare |
| 비회원 임시 저장의 세션 ID, 내부 장소 ID, 저장 시각 | 가입 전 장소 선택 유지·로그인 후 계정 연결 | D1 `guest_saved_places` | 세션당 최대50곳. 기존 guest 세션 최대30일 수명을 따르며 해제·성공 연결 시 삭제, 만료 세션 정리 시 cascade 삭제. 공개 반응·회원 저장과 구분 | Cloudflare |
| 추천·비추천 이벤트, 현재 투표 | 추천율 산출·변경 이력 | D1 | 탈퇴 후에도 익명 사용자에 연결해 집계 유지. 식별 정보는 제거 | Cloudflare |
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

비회원 공개 열람은 허용하고 공개 추천·비추천과 회원의 영구 저장은 서버 로그인 조건을 유지한다. guest 쿠키는 암호학적 난수로 만든 불투명 ID이며 HttpOnly·SameSite=Lax, HTTPS에서는 Secure 속성을 사용한다. 쿠키 ID를 URL·요청 body에서 다른 세션의 소유권 증명으로 받지 않는다. 신규 HMAC 쿠키나 외부 추적 공급자를 추가하지 않았다.

현재 맞춤형 광고, 민감정보, 고유식별정보, 14세 미만 아동 대상 수집, 제3자 판매는 하지 않는다. 만 14세 미만은 가입을 받지 않으며 생년월일은 저장하지 않는다. 결제·이메일·분석·크래시 도구를 도입할 때 이 표와 처리방침을 같은 릴리스에서 갱신한다.

## 출시 차단 항목

- 운영자의 법적 명칭·주소 확정
- 개인정보 보호책임자 성명/직책/실제 이메일·전화 확정
- Cloudflare 계약 주체, 처리 위치, 국외 이전 국가·일시·방법·보유기간 확인


## W04 구현 근거와 후속 대조 범위

- `app/features/onboarding/guest-session.server.ts`: 무작위 guest ID·쿠키·기존30일 수명.
- `app/features/onboarding/guest-saves.server.ts`, `app/routes/guest-saves-resource.ts`:50곳 상한, cookie 소유·POST 제한, GET 쓰기0.
- `app/features/onboarding/guest-merge.server.ts`: 회원의 기존 값 보존, 병합 batch 원자성과 성공 후 임시 원본 정리/쿠키 만료.
- `app/features/saves/save.server.ts`, `app/features/auth/account.server.ts`: 명시 선택표식과 탈퇴 삭제.
- `app/features/onboarding/data-lifecycle.server.ts`, `drizzle/0041_guest_saved_places.sql`: 만료·24시간 이전 창 정리와 FK cascade.

이 대조는 수집·보존 정책을 새로 정하지 않는다. 출시 차단 항목은 실제 입력과 운영 설정 확인 후 별도 PR로 닫는다. 리뷰어 권리·촬영일·검수/audit 메타데이터는 아직 병합 전인 #359의 구현·데이터 수명·공개 경계를 확인한 뒤 추가 대조해야 하며, 이 문서에서 수집·검수 완료로 간주하지 않는다.
