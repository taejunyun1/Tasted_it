# Re:Taste

광주·전남의 검수된 음식점을 현재 위치 기반 네이버 지도에서 탐색하고, 추천·비추천과 저장으로 개인 취향을 기록하는 서비스입니다.

## 아키텍처와 기술 스택

현재 기본 스택, 조건부 기술, 신규 의존성·외부 공급자·데이터 저장소의 승인 기준은 [`docs/decisions/2026-08-10-tech-stack-governance.md`](docs/decisions/2026-08-10-tech-stack-governance.md)를 따릅니다. 저장소에 이미 존재하는 기술도 해당 문서의 확장 승인을 자동으로 의미하지 않습니다.

변경과 운영 계획의 승인 기록은 [`docs/decisions/2026-08-12-pr-merge-approval-ssot.md`](docs/decisions/2026-08-12-pr-merge-approval-ssot.md)를 따릅니다. 권한 있는 담당자가 Pull Request를 병합하면 본문에 명시된 범위는 승인 완료이며, 병합 뒤 같은 범위의 별도 채팅 승인을 다시 요청하지 않습니다.

## 로컬 실행

Node.js와 pnpm을 준비한 뒤 다음 명령을 실행합니다.

```bash
pnpm install
pnpm run db:migrate:local
pnpm run db:seed:local
pnpm dev --host 127.0.0.1
```

기본 주소는 `http://localhost:5173`입니다. 네이버 클라우드 플랫폼 Web Dynamic Map의 Web 서비스 URL에도 이 주소를 등록합니다.

## 환경 변수와 비밀값

로컬에서는 `.dev.vars`, Cloudflare에서는 `wrangler secret put <NAME>`을 사용합니다. 실제 값은 저장소에 커밋하지 않습니다.

| 이름 | 용도 | 관리 방식 |
| --- | --- | --- |
| `NAVER_MAPS_CLIENT_ID` | 네이버 Web Dynamic Map Client ID | secret |
| `NAVER_PLACE_GEOCODING_ENABLED` | 장소 제안·관리자 위치 확인용 NAVER 주소 지오코딩 kill switch | 환경별 변수 (`false` 안전 기본값, 이번 운영 배포는 `true`) |
| `NAVER_LOCAL_SEARCH_CLIENT_ID` | NAVER 지역검색 서버 요청 식별자 | secret |
| `NAVER_LOCAL_SEARCH_CLIENT_SECRET` | NAVER 지역검색 서버 요청 비밀값 | secret |
| `NAVER_LOCAL_SEARCH_ENABLED` | NAVER 지역검색 카테고리 검증 kill switch | 환경별 변수 (운영 `true`, 문제 시 `false`로 즉시 중단) |
| `NAVER_LOCAL_SEARCH_DAILY_LIMIT` | 하루 최대 NAVER 지역검색 호출 수 | 환경별 변수 (`200` 초기 상한) |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 일반 인증키 | secret |
| `ADMIN_EMAIL` | 가입 시 ADMIN 역할을 부여할 운영자 이메일 | secret |
| `RESEND_API_KEY` | 가입 인증·비밀번호 재설정 메일 발송 | secret |
| `RESEND_FROM_EMAIL` | Resend에서 인증한 발신 주소 | secret |
| `APP_BASE_URL` | 이메일 링크의 공개 서비스 기준 URL | 환경별 변수 또는 secret |
| `GOOGLE_CLIENT_ID` | Google OAuth 웹 클라이언트 ID와 ID 토큰 audience 검증 | secret |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 승인 코드 교환 | secret |
| `NAVER_LOGIN_CLIENT_ID` | 네이버 로그인 OIDC Client ID | secret |
| `NAVER_LOGIN_CLIENT_SECRET` | 네이버 로그인 승인 코드 교환·연동 해제 | secret |
| `REVIEW_PHOTO_UPLOAD_ENABLED` | 리뷰어 발행 사진 신규 업로드 kill switch | 환경별 변수 (`false` 기본값) |
| `PLACE_CATEGORY_V5_ENABLED` | v5 장소 분류 shadow 실행 kill switch | 환경별 변수 (`false` 기본값, 공개 카테고리 자동 변경 없음) |
| `COURSE_CONTEXT_V2_ENABLED` | 시간대·영업정보·메뉴 궁합 코스 추천 v2 | 환경별 변수 (`false` 기본값, 문제 시 v1 즉시 복귀) |

리뷰어 사진은 Cloudflare R2 `REVIEW_PHOTOS` binding을 사용하며 비밀값이 아닙니다. bucket 생성, 원격 D1 migration `0027`까지 적용, flag rollout, 비용·삭제 절차는 [리뷰어 발행 사진 저장소 운영 절차](docs/operations/reviewer-photo-storage.md)를 따릅니다. 개발·E2E는 local Miniflare R2만 사용하며, 운영 bucket과 원격 D1을 테스트에 사용하지 않습니다.

예시:

```bash
pnpm exec wrangler secret put NAVER_MAPS_CLIENT_ID
pnpm exec wrangler secret put NAVER_LOCAL_SEARCH_CLIENT_ID
pnpm exec wrangler secret put NAVER_LOCAL_SEARCH_CLIENT_SECRET
pnpm exec wrangler secret put DATA_GO_KR_SERVICE_KEY
pnpm exec wrangler secret put ADMIN_EMAIL
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put RESEND_FROM_EMAIL
pnpm exec wrangler secret put APP_BASE_URL
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put NAVER_LOGIN_CLIENT_ID
pnpm exec wrangler secret put NAVER_LOGIN_CLIENT_SECRET
pnpm exec wrangler secret list
```

장소 제안의 지도 위치 확인은 기존 NAVER Maps 애플리케이션의 Geocoding 기능을 재사용합니다. 새 키나 장소 ID 저장은 없으며, 주소 검색은 사용자가 `지도에서 위치 찾기`를 누를 때만 실행됩니다. 이번 운영 배포에서 `NAVER_PLACE_GEOCODING_ENABLED=true`로 활성화하며, 배포 전 NAVER Cloud의 Geocoding 상품, Web 서비스 URL, 일일 쿼터를 확인합니다. 상세 절차와 장애 시 중단 방법은 [장소 제안 지도 위치 런북](docs/operations/place-suggestion-map-runbook.md)을 따릅니다.

NAVER 지역검색은 사용자 공개 화면에서 호출하지 않습니다. 새 공공데이터 후보 또는 관리자의 명시 재검증에서만 서버가 상호·주소를 전송하며, 응답의 원문·이미지·리뷰·소개·장소 ID·링크는 D1 또는 애플리케이션 로그에 저장하지 않습니다. `NAVER_LOCAL_SEARCH_ENABLED=false`로 즉시 중단할 수 있고, 중단 또는 제공자 오류 시 기존 공공데이터·상호 규칙 분류를 유지합니다.

장소 분류 v5는 기존 공개 카테고리를 즉시 바꾸지 않습니다. `PLACE_CATEGORY_V5_ENABLED=true`는 최대 100곳씩 **그림자 프로필**만 저장하며, 상세 메뉴 근거가 없는 한식·일식·중식·양식은 일반 카테고리로 남깁니다. NAVER는 상호+주소 또는 100m 이내 일치와 구체 카테고리가 모두 있을 때만 보조 검증으로 사용하고, 넓은 업태와 AI 단독 결과는 공개 변경 근거가 될 수 없습니다. 100곳 이상 표본의 차이를 검수한 별도 activate PR에서만 verified forward-fix를 허용합니다.

코스 추천 v2는 `COURSE_CONTEXT_V2_ENABLED=true`일 때만 사용합니다. 관리자 확인 영업시간이 없는 장소는 `UNKNOWN`으로 감점하며, `CLOSED`는 제외합니다. 외부 영업시간·사용자 위치·AI 원문은 새로 저장하지 않습니다.

공개 장소 재분류는 NAVER 상호·주소/100m 위치·구체 카테고리와 원천 세부업태가 모두 맞는 경우만 적용합니다. 최초에는 100곳 미리보기 후 변경 수와 audit을 확인하고 적용합니다. 상세한 quota, 중단, forward-fix 절차는 [NAVER 지역검색 카테고리 검증 운영 절차](docs/operations/naver-local-category-runbook.md)를 따릅니다.

Google Cloud Console의 웹 OAuth 클라이언트에는 다음 주소를 정확히 등록합니다.

승인된 JavaScript 원본:

```text
http://localhost:5173
https://retaste-beta.retaste-beta.workers.dev
```

승인된 리디렉션 URI:

```text
http://localhost:5173/auth/google/callback
https://retaste-beta.retaste-beta.workers.dev/auth/google/callback
```

Google 로그인은 `openid email profile` 권한만 사용합니다. 클라이언트 보안 비밀번호, 승인 코드, Google 토큰은 저장소·DB·로그에 남기지 않습니다.

네이버 개발자센터의 네이버 로그인 애플리케이션에는 다음 Callback URL을 정확히 등록합니다.

```text
http://localhost:5173/auth/naver/callback
https://retaste-beta.retaste-beta.workers.dev/auth/naver/callback
```

네이버 로그인은 `openid` 권한과 이메일·이름/닉네임만 사용합니다. `NAVER_MAPS_CLIENT_ID`와 로그인 Client ID는 서로 다른 값입니다. 승인 코드, 액세스 토큰, 갱신 토큰은 저장소·DB·로그에 남기지 않습니다. 전체 이용자에게 공개하기 전 네이버 개발자센터 검수를 완료해야 하며, 검수 전에는 등록된 개발 계정으로만 확인합니다.

운영 반영 순서는 `0016_naver_oidc_auth.sql` 원격 D1 migration 적용, 네이버 비밀값 등록, 병합된 `main` 배포, 지정 개발 계정 로그인·연결·해제 스모크 확인입니다.

## 검증

```bash
pnpm test
pnpm run test:integration
pnpm run test:e2e
pnpm run typecheck
pnpm run build
```

E2E는 로컬 D1 migration, 샘플 데이터, 관리자 QA fixture를 자동 준비합니다. 운영 데이터에는 QA fixture를 적용하지 않습니다.

## 통합 기록 감사

관리자는 `/admin/audit`에서 평가·리뷰 사진·Golden Pick·보존기간·추천 적격성의 읽기 전용 기준선 감사를 확인할 수 있습니다. 실행 기준, 개인정보 최소화, 결과 기록과 후속 조치 절차는 [통합 기록 감사 운영 문서](docs/operations/record-audit-runbook.md)를 따릅니다.

## 배포

모든 변경은 feature branch → PR → checks 통과 → squash merge 순서로 `main`에 반영합니다. 운영 배포는 병합된 `main`에서만 실행합니다.

```bash
pnpm run deploy
```

첫 운영 배포 전에는 D1 원격 migration과 위 비밀값 등록이 필요합니다.
