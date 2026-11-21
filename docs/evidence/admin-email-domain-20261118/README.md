# B11.2 메일 도메인 검증

2026-11-18 · #454. 운영 호출·도메인 생성/검증·메일 발신은 실행하지 않았다.

- Workers 통합: 단발 생성 경합/재확정, timeout 보존, 성공 직후 목록 부재·다른 ID, 조회 실패, 비동기 접수와 실제 검증 구분, stale/대상 변조, 원자 접수 응답 유실의 외부 호출 0.
- 기존 HTTP 권한 회귀: 익명/일반 회원 차단, 미설정 시 잠긴 조회 화면, 교차 출처 POST 거부.
- 0059 전후 기존 operation/commit/check rowid·필드 동일, FK·불변 영수증·세션 철회 관계 검증.
- unit adapter: 지정 호스트와 도메인·ID 대조, 불완전 목록과 오류 비밀값 비노출.
- desktop/mobile E2E 4건: 미설정 잠금 화면, 일반 회원 거부, JS/HTTP500 0, 320px 가로 넘침 0. 이미지의 synthetic 설정은 운영 정보가 아니다. 활성 도메인 변경 경계는 mock 통합 검증이며 이 화면 증거로 실제 공급자 성공을 주장하지 않는다.
- 타입/빌드와 production dependency audit 통과. 독립 core review에서 발견한 중복 생성·ID 대조 경계를 수정했다.

[desktop](desktop.png) · [mobile](mobile.png) · [320px](width-320.png)

Resend 공식 [검증 API](https://resend.com/docs/api-reference/domains/verify-domain)는 비동기 요청이다. [생성 API](https://resend.com/docs/api-reference/domains/create-domain)·[목록 API](https://resend.com/docs/api-reference/domains/list-domains)와 기존 adapter를 대조했다. API 접수, 관측된 도메인 검증, 실제 수신은 별개의 증거로 표시한다.
