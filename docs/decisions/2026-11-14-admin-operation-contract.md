# ADMIN P0 작업 확정 계약

- 상태: ACCEPTED 범위의 구현 명세. 상위 추적 [#408](https://github.com/taejunyun1/Tasted_it/issues/408), B02 담당 Jay/Codex.
- 사용자 요청으로 별도 ADMIN 계획 중 B01–B05(P0)의 구현을 진행한다. 이 PR은 B02 공통 계약과 신규 migration `0042`만 구현하며, 각 화면·원격 적용 완료를 뜻하지 않는다.
- B06 이후와 전역 세부 권한 체계는 기존 계획대로 후속이다. 기존 ADMIN 역할을 서버에서 매번 확인한다.

## 입력·미리보기

미리보기는 현재 ADMIN 세션에 결속한 서버 payload와 SHA-256, 대상 건수·작업 종류를 10분 보관한다. 브라우저가 제출한 변경 본문은 확정 때 다시 사용하지 않는다. payload는 2MiB, 활성 미리보기는 관리자당 20개, 중첩은 12단계로 제한한다. 원문 비밀번호·토큰·쿠키 등의 필드는 거절한다. 저장 내용은 공개 응답이나 감사 로그로 복사하지 않으며, 확정 때 본문을 지우고 결과만 보존한다. 만료된 미확정 자료는 다음 준비 시 최대 50개씩 정리한다.

| 종류 | 최대 대상 | 확정 직전 최근 인증 |
|---|---:|---|
| CSV_IMPORT | 200 | 필요 |
| RATING_RECOMPUTE | 1 | 현재 ADMIN 세션 |
| INTEGRITY_CASE_TRANSITION / VOTE_INVALIDATE | 1 | 필요 |
| ADMIN_ROLE_CHANGE / ADMIN_SESSIONS_REVOKE | 1 | 필요 |
| TEMP_PUBLISH / TEMP_UNPUBLISH | 100 | 필요 |

최근 인증은 동일 세션·동일 계정에 결속하고 10분 이내 실제 PASSWORD/GOOGLE/NAVER/EMAIL 검증을 B03이 기록한다. UI 클릭이나 세션 생성만으로 인증을 부여하지 않는다. 구체 공급자별 신선도 검증은 B03 PR에서 확정한다.

## 확정과 결과

`prepareAdminOperation → getAdminOperation → commitAdminOperation` 순서로 호출한다. 확정 adapter는 현재 대상/version을 확인하는 `admin_operation_checks` 문장과 허용된 변이 문장을 반환한다. 한 D1 batch에서 현재 ADMIN·세션·만료·최근 인증 재확인, 중복 방지 claim, 대상 CAS, 변이, 요약 감사, 결과 영수증을 원자적으로 저장한다. 하나라도 실패하면 전체 rollback한다.

같은 요청이 동시에 오거나 성공 응답이 유실되면 저장된 결과를 재조회한다. 이미 확정된 요청을 재실행하지 않는다. 대상이 바뀐 요청은 충돌, 결과를 확인할 수 없는 오류는 결과 불명으로 구별한다. 재계산의 접수 영수증은 작업 완료를 뜻하지 않으며 B04가 정확한 job ID 상태를 추적한다. 감사에는 작업 종류·건수·제한된 결과만 남긴다.

확정 영수증·감사 기록은 수정/삭제를 차단한다. 로그아웃/세션 철회는 결속 FK를 NULL로 정리할 수 있고 원래 영수증을 보존한다. 앱에서 임의 SQL·shell·secret 접근 기능을 제공하지 않는다.

## 검증·운영 경계

로컬 실제 D1 호환 실행으로 다른 계정/세션 접근, 역할 철회, 최근 인증 만료, 동시 확정, 대상 변경, 감사 실패 rollback, 세션 철회 후 영수증 보존을 검증한다. 합성 fixture의 필수 category 열 누락으로 최초 성공 시험이 실패한 이력은 보존하며, fixture를 실제 스키마에 맞춰 수정한다. 테스트 기대나 timeout을 완화하지 않는다.

`0042`는 아직 미적용 신규 schema다. 기존 `0040/0041` 수정이나 기존 운영 자료 삭제는 없다. 운영 migration은 다른 P0·TEMP 변경을 포함한 별도 구체 rollout PR에 계정/DB/중단창/백업/검증/복구 범위를 기록한 뒤, 그 병합 main으로만 지정 운영자가 실행한다. 이 PR 자체로 원격 D1, 이메일, 유료 API, R2 업로드를 실행하지 않는다.
