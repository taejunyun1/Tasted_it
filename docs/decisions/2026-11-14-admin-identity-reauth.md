# 관리자 권한·세션과 재인증

- 상태: 구현 검토, 병합 시 ACCEPTED
- 담당: Jay / ADMIN P0 B03, #408 / #410
- 범위: 기존 D1·세션·비밀번호·Google/NAVER·Resend만 사용한다. 의존성, 공급자, 환경 변수, binding을 추가하지 않는다.

## 결정

관리자 역할 변경과 세션 회수는 공통 운영 변경 계약의 미리보기→확정 절차를 사용한다. 확정 시 현재 관리자 역할, 활성 세션, 최근 10분 재인증, 대상 버전을 다시 검사한다. 변경·감사 이력·멱등 영수증은 하나의 D1 batch로 기록한다. 본인 역할 변경을 금지하고, 마지막 관리자 삭제·강등·이메일 검증 제거는 SQLite trigger로 동시 요청에서도 거부한다. 로그인할 수 없는 미인증 자동 파이프라인 계정은 잔여 관리자로 세지 않는다. 관리자 부여 이전 USER/REVIEWER 역할을 보관하고 회수 시 복원한다. REVIEWER 복원은 활성 프로필이 있을 때만 허용한다.

역할 변경은 대상의 로그인 세션을 회수한다. 개별 세션 회수는 bearer 세션 ID 대신 SHA-256 참조를 화면에 제공한다. 작업 중인 현재 세션은 유지하며 본인의 전체 로그아웃은 기존 로그아웃 경로를 사용한다. 일반 로그인과 재가입 검증은 기존 계정의 운영자가 지정한 역할을 덮어쓰지 않는다.

## 실제 재인증 경계

- 비밀번호: 현재 계정의 저장된 비밀번호를 실제로 검증한다.
- NAVER: 공식 `auth_type=reauthenticate`를 요청하고, nonce·PKCE·서명 검증을 마친 동일 연결 subject만 허용한다. [NAVER 개발 가이드](https://developers.naver.com/docs/login/devguide/devguide.md)
- Google: 계정 선택은 재인증 증거가 아니다. 서명된 `auth_time`이 요청 시각 이후인 경우에만 인정한다. 이 claim은 Google의 앱 검증과 콘솔 설정에 의존하므로 없거나 오래되면 이메일 인증으로 안내한다. [Google Security bundle](https://developers.google.com/identity/siwg/security-bundle), [OIDC reference](https://developers.google.com/identity/openid-connect/reference)
- 이메일: 검증된 현재 계정 이메일에 기존 Resend로 8자리 일회 코드를 보낸다. 10분·현재 세션에 묶고 해시만 보관한다. 시도 한도는 계정/IP당 15분 10회, 발송은 시간당 3회와 60초 간격이다. 자격증명을 변경하거나 새 비밀번호를 설정하지 않는다.

외부 인증은 사용자가 버튼을 누른 경우에만 수행한다. OAuth callback은 최초 세션·계정·연결 subject와 일치해야 하며 새 계정, 새 세션, 새 연결을 만들지 않는다. CSRF는 동일 origin POST로 제한한다. 코드와 비밀번호는 loader·URL·로그·감사 이력에 기록하지 않는다.

## 검증 및 운영 한도

로컬 synthetic 계정과 mock 외부 인증을 사용한다. 비밀번호/코드 실패, 만료, 다른 세션, 역할 회수, 재사용, 시도 한도, 마지막 관리자 동시 강등, 대상 변경 충돌, 멱등 확정 및 감사 이력 불변성을 확인한다. 데스크톱·모바일에서 관리 목록→미리보기→재인증 안내 경로를 확인한다.

운영 배포·D1 migration 0042/0043은 병합된 main에서 지정된 배포 담당자가 수행한다. 이 PR의 기본 live 검증은 비인가 요청 거부와 화면 렌더링이며 실제 운영 계정 역할 변경·이메일 발송·OAuth 호출은 0회다. 실수신 확인 없이 메일 전달 성공을 선언하지 않는다. 별도 한정 canary는 대상 계정·변경·복구를 명시한 후 실행한다.

## 비용·개인정보·rollback

기존 이메일·계정·세션 정보만 다루며 코드 원문을 저장하지 않는다. 사용자가 요청한 재인증 메일만 기존 발송 비용이 발생한다. 0043은 추가 테이블과 보호 trigger이며 기존 자료를 삭제하지 않는다. Worker를 직전 버전으로 되돌려 UI를 중지할 수 있다. 이미 확정된 역할 변경은 감사 영수증을 기준으로 별도 승인된 역변경으로 복구한다. 마지막 관리자 보호 trigger를 임의 제거하지 않는다.

## 화면 증거

- [권한 관리 데스크톱](../evidence/2026-11-14-admin-identity-console-desktop.png) / [모바일](../evidence/2026-11-14-admin-identity-console-mobile.png)
- [재인증 데스크톱](../evidence/2026-11-14-admin-reauthentication-desktop.png) / [모바일](../evidence/2026-11-14-admin-reauthentication-mobile.png)

모두 로컬 합성 계정이다. 화면 폭 초과와 hydration 오류가 없으며 개인정보 응답의 `private, no-store` / `Vary: Cookie`를 확인했다.
