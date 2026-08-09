# 네이버 OIDC 로그인 및 계정 연결 설계

## 1. 목적

Re:Taste의 기존 이메일·Google 로그인에 네이버 로그인을 추가한다. 신규 네이버 회원은 별도의 비밀번호 입력 없이 가입하고 로그인할 수 있어야 하며, 기존 회원은 로그인한 상태에서 네이버 계정을 연결할 수 있어야 한다.

개인정보는 네이버 이용자 고유 식별자, 연락처 이메일, 표시 이름에 필요한 이름 또는 닉네임만 사용한다. 액세스 토큰과 갱신 토큰은 영구 저장하지 않는다.

관련 작업: GitHub Issue #61

공식 기준 문서: [네이버 로그인 개발가이드](https://developers.naver.com/docs/login/devguide/devguide.md)

## 2. 작업 범위

### 포함

- 네이버 OpenID Connect(OIDC) 승인 코드 로그인
- PKCE와 state를 이용한 요청 검증
- 네이버 ID token 검증과 프로필 조회
- 네이버 신규 계정 생성과 기존 연결 계정 로그인
- 로그인한 기존 회원의 네이버 계정 연결
- 재인증 후 네이버 연동 해제와 Token Revocation 기반
- 로그인·회원가입 네이버 버튼과 오류 안내
- 인증 provider 공통 경계 정리
- 단위·통합·브라우저 검증과 운영 설정 문서

### 제외

- 메인 지도 A형 리디자인
- 이메일·비밀번호 변경과 즉시 탈퇴 화면 전체
- 네이버 프로필 사진, 성별, 생일, 연령대, 출생연도, 휴대전화번호 수집
- 네이버 액세스·갱신 토큰 장기 보관과 네이버 Open API 사용
- 운영 D1 migration 적용, 네이버 애플리케이션 검수 제출, 운영 배포

## 3. 선택한 접근

### 공통 OAuth 보안 코어 + provider 어댑터

Google과 네이버가 공통으로 사용하는 요청 생성·state 검증·일회용 소비·세션 발급·계정 연결 정책을 공통 모듈로 둔다. ID token 검증, 승인·토큰 URL, 프로필 정보 획득과 오류 매핑은 provider별 어댑터에서 처리한다.

### 검토한 대안

- Google 구현 복제: 초기 구현은 빠르지만 보안 수정과 계정 연결 정책이 두 벌로 갈라진다.
- Auth.js 등 인증 프레임워크 전환: provider 확장은 편해지지만 현재 인증·D1·세션 구조를 과도하게 바꾼다.

현재 제품의 인증 구조를 유지하면서 중복을 줄일 수 있으므로 공통 코어와 어댑터 방식을 선택한다.

## 4. 네이버 인증 흐름

### 4.1 로그인 시작

1. `/auth/naver`가 `returnTo`를 안전한 내부 경로로 정규화한다.
2. 서버가 256비트 이상의 state와 PKCE code verifier를 생성한다.
3. D1 OAuth 요청에 state hash, provider, flow, code verifier, 만료 시각을 저장한다.
4. 브라우저 쿠키에는 추측 불가능한 OAuth 요청 ID만 저장한다.
5. 네이버 OIDC 승인 URL로 이동한다.

승인 요청은 `response_type=code`, `scope=openid`, PKCE S256을 사용한다. 애플리케이션 설정에서는 이용자 식별자와 이메일을 필수로, 이름 또는 닉네임을 표시 이름 후보로 요청한다.

### 4.2 callback과 검증

1. `/auth/naver/callback`이 cookie의 요청 ID와 callback state를 대조한다.
2. 요청이 10분 이내이고 미사용 상태인지 확인한 뒤 한 번만 소비한다.
3. callback code와 code verifier로 네이버 토큰 엔드포인트를 호출한다.
4. 네이버 JWK로 ID token 서명을 검증한다.
5. issuer, audience, subject, 발급·만료 시각을 검증한다.
6. 액세스 토큰으로 프로필 API를 한 번 호출한다.
7. ID token subject와 프로필 이용자 식별자가 같아야 한다.
8. 이메일을 정규화하고 표시 이름을 `닉네임 → 이름 → 네이버 회원` 순서로 결정한다.

이메일이 없거나 형식이 유효하지 않으면 가입·연결을 중단하고, 네이버 정보 제공 동의가 필요하다는 제한된 오류를 표시한다. 네이버가 반환한 원문 오류나 토큰은 URL·로그·화면에 노출하지 않는다.

### 4.3 계정 판정

다음 순서로 처리한다.

1. `NAVER + provider subject` identity가 있으면 연결된 Re:Taste 회원으로 로그인한다.
2. 로그인한 회원의 `CONNECT` 요청이면 해당 회원에 identity를 연결한다.
3. 로그아웃 상태이고 같은 이메일의 기존 Re:Taste 계정이 없으면 신규 회원과 NAVER identity를 생성한다.
4. 로그아웃 상태이고 같은 이메일의 기존 계정이 있으면 자동 병합하거나 로그인시키지 않는다.

4번에서는 `기존 로그인 방식으로 로그인한 뒤 내 정보에서 네이버를 연결하세요`라고 안내한다. 네이버 연락처 이메일만으로 기존 계정 소유를 확정하지 않아 계정 탈취를 방지한다.

신규 네이버 계정의 이메일은 네이버가 인증 후 제공한 로그인 프로필로 취급해 Re:Taste의 `emailVerifiedAt`을 설정한다. 이후 이메일 변경은 별도의 Re:Taste 이메일 인증 흐름을 거친다.

## 5. 연결과 연동 해제

### 연결

- 사용자가 Re:Taste에 로그인한 상태에서만 `CONNECT`를 시작할 수 있다.
- callback의 네이버 subject가 다른 Re:Taste 회원에 이미 연결돼 있으면 실패한다.
- provider별로 한 회원당 하나의 identity만 허용한다.
- 연결 성공 후 기존 Re:Taste 세션과 취향 데이터는 그대로 유지한다.

### 연동 해제

- 연동 해제는 `DISCONNECT` flow로 네이버 재인증을 요구한다.
- 재인증된 subject가 현재 회원의 NAVER identity와 같아야 한다.
- callback에서 받은 액세스 토큰으로 네이버 Token Revocation API를 호출한다.
- 폐기가 성공한 뒤 로컬 NAVER identity를 삭제한다.
- 비밀번호 또는 다른 SNS identity가 없어 로그인 수단이 사라지는 경우 연동 해제를 차단한다.
- 네이버 폐기에 실패하면 로컬 identity를 먼저 삭제하지 않고 재시도를 안내한다.

액세스·갱신 토큰은 재인증 callback 처리 중에만 메모리에서 사용하고 저장하지 않는다.

## 6. 데이터 모델

### `auth_identities`

- provider 허용값에 `NAVER`를 추가한다.
- 기존 `provider_subject`, `provider_email`, `user_id` 구조를 그대로 사용한다.
- provider와 subject의 전역 유일성, provider와 user의 유일성을 유지한다.

### `oauth_requests`

신규 migration에서 다음 필드를 추가한다.

- `provider`: `GOOGLE | NAVER`
- `flow`: `LOGIN | CONNECT | DISCONNECT`
- `code_verifier`: PKCE 교환에 필요한 일회성 verifier

기존 Google 요청은 기본 provider `GOOGLE`, flow `LOGIN`으로 해석한다. callback에서 요청을 소비할 때 code verifier를 즉시 비우고 소비 시각을 기록한다. 만료·소비된 요청은 정기 정리 대상이다.

이미 운영에 적용된 `0015_google_oauth.sql`은 수정하지 않고 신규 `0016_naver_oidc_auth.sql`을 추가한다.

## 7. 보안 계약

- state 원문은 D1에 저장하지 않고 SHA-256 hash만 저장한다.
- PKCE는 S256을 사용한다.
- OAuth 요청 cookie는 `HttpOnly`, `SameSite=Lax`, 운영 HTTPS에서 `Secure`를 사용한다.
- callback 요청은 10분 만료, 단일 사용, provider·flow 일치를 모두 확인한다.
- ID token은 네이버 공식 JWK를 이용해 검증한다.
- access token, refresh token, authorization code, client secret을 DB·로그·오류 화면에 저장하거나 노출하지 않는다.
- 외부 오류는 `취소됨`, `이메일 동의 필요`, `기존 계정 로그인 필요`, `일시적 오류`의 제한된 코드로 변환한다.
- 로그인 성공 후 기존 Re:Taste 세션 cookie 정책을 그대로 사용한다.
- 계정 연결·연동 해제는 로그인 세션과 OAuth 재인증 결과를 모두 요구한다.

## 8. 화면 설계

### 로그인·회원가입

Google 버튼 아래에 네이버 고유의 녹색 버튼을 동일 높이로 배치한다. 네이버의 `N` 표식과 `네이버로 계속하기` 문구를 사용해 provider를 즉시 구분한다.

버튼 순서는 현재 주요 로그인 수단인 Google, 네이버, 이메일 순으로 유지한다. 모바일에서도 버튼은 한 열 전체 폭을 사용한다.

### 오류 안내

- 사용자가 취소함: `네이버 로그인이 취소되었습니다.`
- 이메일 미제공: `네이버에서 이메일 제공에 동의해야 가입할 수 있습니다.`
- 기존 이메일 계정 존재: `기존 방식으로 로그인한 뒤 내 정보에서 네이버를 연결해주세요.`
- provider 충돌: `이 네이버 계정은 다른 Re:Taste 계정에 연결되어 있습니다.`
- 외부 장애: `잠시 후 다시 시도해주세요.`

상세 provider 오류 코드나 이메일 존재 여부는 필요한 흐름 외에는 노출하지 않는다.

## 9. 환경 변수와 네이버 설정

신규 Worker secret:

- `NAVER_LOGIN_CLIENT_ID`
- `NAVER_LOGIN_CLIENT_SECRET`

지도용 `NAVER_MAPS_CLIENT_ID`와 로그인 Client ID를 명확히 분리한다.

개발자센터에 다음 callback을 등록한다.

- 로컬: `http://localhost:5173/auth/naver/callback`
- 운영: `https://retaste-beta.retaste-beta.workers.dev/auth/naver/callback`

로그인·회원가입 화면, 개인정보 처리방침, 연동 해제 흐름과 테스트 계정을 준비한 후 네이버 사전 검수를 신청한다. 검수 승인 전에는 등록된 개발 계정만 로그인할 수 있다는 운영 제약을 문서에 표시한다.

## 10. 테스트 전략

### 단위 테스트

- 승인 URL에 state, openid scope, PKCE S256, 안전한 redirect URI가 포함되는지 검증한다.
- token 응답과 ID token 검증 실패를 제한된 오류로 변환하는지 검증한다.
- 이메일·subject·표시 이름 정규화를 검증한다.
- access·refresh token이 반환 객체나 저장 값에 포함되지 않는지 검증한다.
- 기존 이메일 계정의 자동 연결을 차단하는지 검증한다.

### D1 통합 테스트

- OAuth 요청 단일 소비와 만료를 검증한다.
- 신규 NAVER identity와 회원 생성 원자성을 검증한다.
- 기존 연결 identity 로그인과 provider 충돌을 검증한다.
- 로그인한 회원의 연결과 유일성 제약을 검증한다.
- 연동 해제 시 다른 로그인 수단이 없으면 차단되는지 검증한다.
- revocation 실패 시 identity가 유지되는지 검증한다.

### 브라우저 검증

- 로그인·회원가입 데스크톱과 390px 모바일에서 네이버 버튼을 확인한다.
- 취소·이메일 미동의·기존 계정 안내를 확인한다.
- OAuth callback은 mock provider 또는 결정적 fixture로 자동화하고 실제 네이버 계정 스모크는 운영 설정 후 한 번만 수행한다.
- 콘솔 오류, 페이지 오류, 가로 넘침이 없는지 확인한다.

## 11. 운영 영향과 위험

- 신규 D1 migration `0016_naver_oidc_auth.sql`이 필요하다.
- 신규 Worker secrets 두 개와 네이버 개발자센터 callback 등록이 필요하다.
- 네이버 사전 검수 전에는 전체 사용자 공개가 제한된다.
- 네이버 OIDC와 프로필 API 장애 시 이메일·Google 로그인은 계속 사용할 수 있어야 한다.
- 실제 네이버 인증과 Token Revocation은 운영 배포 후 지정 계정으로 스모크 검증한다.
- 배포는 독립적인 사람의 PR 승인과 필수 검증 통과 후 병합된 `main`에서 수행한다.
