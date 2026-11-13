# ADMIN 전역 운영 통제 계획

- 상태: **P0(B01–B05) ACCEPTED_IMPLEMENTATION / P1–P2 PROPOSED**. 사용자의 2026-11-14 명시 요청에 따라 P0를 구현한다. 전 기능 또는 임의 운영 변경의 일괄 승인은 아니다.
- 작성·코드 대조: 2026-11-14, `origin/main@76dce1e071581c4ff6d8b40f84412d2bff2a3052`. 최초 목록 대조 후 #403의 전면 점검 차단과 스키마 전환 복구 경계를 반영했다.
- 추적: [#399](https://github.com/taejunyun1/Tasted_it/issues/399). 계획 작성·후속 개발 주담당은 Jay/Codex, 범위·정책 수용은 사용자, 운영 실행은 승인된 PR이 지정한 담당자다.
- 최초 계획은 문서만 작성했다. P0 추적은 [#408](https://github.com/taejunyun1/Tasted_it/issues/408)이며 Jay/Codex가 각 독립 PR과 통합·운영 적용을 담당한다.

## 1. 목표와 문서 위계

사용자의 “ADMIN에서 모든 웹서비스를 통제할 수 있도록 별도 계획” 요청을 **서비스의 각 운영 대상에 조회·변경·중단·복구·감사 경로와 책임자가 빠짐없이 연결되는 것**으로 구체화한다. 아래 표는 현재 코드와 앞으로 필요한 통제를 함께 담는다. 전 기능 완성, 무장애, 무손실 또는 100% 통제를 주장하지 않는다.

명시적 사용자 결정/AGENTS/COWORK → 병합 PR의 구체 승인 범위·확정 ADR → [CST 서비스 SSOT](2026-11-13-cst-service-ssot.md) → 이 별도 ADMIN 계획 → 후속 Issue 순서를 따른다. [구현 정책](../decisions/2026-11-13-cst-implementation-policy.md), [기술 거버넌스](../decisions/2026-08-10-tech-stack-governance.md), [PR 승인 기준](../decisions/2026-08-12-pr-merge-approval-ssot.md)을 유지한다.

이 문서의 **현재**는 소스 구현 사실이며 live 배포·실행 성공의 증거가 아니다. **제안**은 후속 Issue/PR에서 설계·검증할 대상이다. 문서 PR이 병합돼도 아래 모든 미구현 작업이나 임의 원격 작업이 일괄 승인되는 것은 아니다. 각 구현/운영 PR에 대상 환경·작업·한도·개인정보/비용·검증·rollback을 명시한다.

12/10의 기존 목표는 내부 검수·실증 준비 완료, 12/18은 원문 업체 납품기한이다. 이 계획은 두 기한을 변경하지 않는다. ADMIN 전체 확장은 별도 추가 범위이므로 기존 CST 120시간 가정에 조용히 더하지 않는다. 필요한 공수를 산정한 뒤 상위 SSOT에서 우선순위·가용 시간을 재배분해야 날짜를 확정할 수 있다.

## P0 구현 현황 — 2026-11-14

| 단위 | 구현·증거 | 배포 상태 |
|---|---|---|
| B01 | #414 `dc68b2a`: 운영 홈·34영역·집계 상한/미확인, 필수4CI·독립리뷰 | 통합 운영 적용 전 |
| B02 | #415 `02f23d7`: 세션 결속 preview·동일 batch CAS/감사/영수증, D1 8건·필수4CI | 통합 운영 적용 전 |
| B03 | #416 `b996512`: 실제 비밀번호/기존 OAuth/이메일 재인증, 마지막 실제관리자 보호·역할 변경·세션철회 | 병합 완료·통합 운영 적용 전 |
| B04 | #418 `7865124`: 정확 job 처리와 재조회, 다른 대기 작업과 완료 구분, 원자 enqueue | 병합 완료·통합 운영 적용 전 |
| B05 | #417 `6f62d1e` 및 통합: CSV 최대200/2MiB·공개 덮어쓰기 차단·사건/표 결속과 재인증 | 병합 완료·통합 운영 적용 전 |

공통 계약은 [B02 결정](../decisions/2026-11-14-admin-operation-contract.md), 인증은 [B03 결정](../decisions/2026-11-14-admin-identity-reauth.md)을 따른다. 최종 통합은 전체 ADMIN 응답의 no-store와 사건 처리 preview/확정/결과불명 재확인을 연결한다. 아래 원래 기준선과 제안 표는 계획 당시의 기록이며, 이 절과 구현 PR의 더 최신 사실이 우선한다. B06 이후는 여전히 후속이며 34개 기능 완성을 뜻하지 않는다.

## 2. 현재 기준선과 통제 원칙

현재 계정 역할은 `USER / REVIEWER / ADMIN`이며 학생은 별도 seat/capability로 관리한다. `requireAdmin()`은 서버 세션과 현재 DB 역할을 확인한다. 기능별 관리자 권한, 위험 작업 재인증, 마지막 관리자 보호, 전역 회원·세션 관리 화면은 아직 없다.[E01]

다음은 **제안 설계**다. 새 role·provider·DB·cron을 이번에 만들지 않는다.

1. **서버 권한표:** 기존 ADMIN을 출발점으로 `content.read`, `content.publish`, `review.moderate`, `identity.manage`, `jobs.control`, `privacy.execute`, `operations.configure` 같은 작업 단위 권한을 서버에서 판정한다. 문자열은 설계 예시이며 현행 권한 이름이 아니다. UI 숨김으로 권한을 대신하지 않는다. 별도 역할 체계가 필요하면 ADR과 migration을 먼저 검토한다.
2. **위험 작업 추가 인증:** 권한 변경·대량 공개/회수·삭제·설정 활성화는 최근 재인증(step-up)을 요구한다. 이메일 비밀번호 계정과 기존 OAuth 계정에 적용 가능한 방식을 각각 설계한다. 재인증 방법·유효시간은 아직 확정하지 않았으며 OAuth 계정에 존재하지 않는 비밀번호를 요구하지 않는다.
3. **대상 고정:** preview에서 대상 ID·현재 version·건수·예상 외부 호출·변경 전후를 계산한다. commit은 같은 대상/version/권한을 다시 검사한다. 검색 조건 전체를 나중에 재평가해 다른 자료를 바꾸지 않는다.
4. **한도와 동시성:** 작업별 요청 크기·건수·외부 호출 상한, 중복 실행 방지 키, DB CAS/lease, 만료·중단 규칙을 둔다. 여러 관리자와 정기 작업이 동시에 실행해도 최신 사용자 선택과 처리 이력을 보존한다.
5. **성공의 정의:** `접수 → 실행 중 → 성공/부분 성공/실패/취소 요청/취소 완료/결과 불명`을 구별한다. HTTP 200, enqueue, UI 토스트를 실제 작업 완료로 표시하지 않는다. 외부 응답 유실은 상태 조회 후 재시도하며 무조건 재실행하지 않는다.
6. **감사와 복원:** 중요한 변경은 actor·대상·작업·사유·version·승인 근거·전후 요약·결과·시각을 연결한다. 감사 기록 저장 실패 시 위험 변경은 시작하지 않는 계약을 정한다. 원문 비밀값·쿠키·토큰·불필요한 자유 문안은 감사에 복제하지 않는다. 기존 원장 삭제/변조로 복원을 구현하지 않는다.
7. **인프라 경계:** ADMIN UI는 임의 SQL/셸/코드 실행, secret 읽기, 클라우드 계정 관리자권한을 제공하지 않는다. 배포·인프라 복구는 지정 운영자와 기존 도구가 수행하고 UI는 승인 범위·진행·증거 링크를 추적한다. 중단 권한과 재활성화 권한은 분리해 설계한다.

## 3. 기능 × 작업 × 권한 × 현재 구현 × gap × 증거

`현재 ADMIN`은 단일 역할 검사라는 뜻이며 추가 인증/세부 권한이 이미 있다는 뜻이 아니다. “없음”은 아래 조사 범위에 대응 관리 경로가 없다는 뜻이다. 운영 상태는 별도 확인해야 한다.

| ID / 기능 | 운영 작업 | 현재 권한·현 구현 | gap / 제안 통제 | 근거 |
|---|---|---|---|---|
| A01 운영 홈 | 전체 현황·메뉴·경보 탐색 | ADMIN 홈은 장소 운영으로 이동. 별도 운영 화면은 처리량/큐/오류 요약 | 도메인별 상태·마지막 갱신·미확인/부분 집계·실행 증거를 묶는 홈과 일관된 메뉴 | E01,E02 |
| A02 회원 | 검색·상태 조회·제한·복구 | 자기 계정 경로와 리뷰어/학생 관리만 있음 | 최소 필드 회원 검색, 제한 사유·기간·이의 처리, 민감정보 제한, 자기 탈퇴와 관리자 조치 구별 | E01,E09 |
| A03 관리자/세션 | 부여·회수·접속 해제 | 가입/OAuth의 지정 관리자 이메일 조건, 세션/현재 DB 역할 검사. 전역 관리 UI 없음 | 마지막 관리자·자기 권한상승 방지, 추가 인증, 세션 철회, 변경 후 기존 세션 권한 재검증 | E01,E09 |
| A04 리뷰어 자격 | 신청 심사·예외 승인·정지·휴면 | ADMIN 신청/활동 관리·사유·audit. 일부 역할/프로필 batch | 신청 시 저장된 제안 수와 현재 근거 구분, version/CAS, 일괄 preview·부분 실패·재활성화 감사 | E04 |
| A05 학생 계정 | 개별 초대·접근 활성/중지 | ADMIN+기능 flag. seat 한정 초대·만료·회수·audit, 토큰 원문은 발급 응답에서만 전달 | 추가 인증, 초대 전달/수락 상태, 재발급 영향 preview. 학생은 ADMIN이나 별도 전역 role이 아님 | E05 |
| A06 학생 업무 | 배정·교차검수·취소 | ADMIN, seat capability, 작업별 소유 검사. PLACE 일괄 최대25, 기록 보존 | 작업 묶음 결과·배정 변경 충돌·실패 복구·권한 회수의 진행중 작업 영향 표시 | E05 |
| A07 장소 목록/상세 | 검색·수정·공개/숨김 | ADMIN 목록은 조회 전용. 실무는 5단계 장소 운영 | 검색/페이지·단일 수정 진입 통합, 원천/표시값/검수 상태 분리, 수정→재검수 영향 preview | E03 |
| A08 제안/정정 | 승인·보완·반려·정정 적용 | ADMIN+동일 origin, 장소 운영에서 처리. 제안 승인은 비공개 초안 | 사유·현재 version·요청 상태·후속 공개 결과를 한 실행 기록에 연결 | E03 |
| A09 CSV | 검증·preview·반영 | ADMIN+동일 origin. 업로드2MB 검사, 행 검증·slug upsert·batch. PUBLISHED 입력도 가능 | 확인 POST 크기·행 수 재검사, 서버에 결속된 preview, 전후 diff·CAS·감사, 검수 없는 대량 공개 통로 제한 | E03 |
| A10 장소 검수/분류 | 원천→NAVER→분류→중복→최종 공개 | ADMIN, stage/version·건수·확인 문구·batch 계약. 옛 후보 URL은 여기로 이동 | 경로별 제각각인 한도/사유/오류 규격 통일, 대량 작업별 진행·부분 실패 재시도 | E03 |
| A11 병합/복원 | 중복 병합·이전 필드 복원 | ADMIN, 사유·revision/audit. 원본 vote 보존·GENERAL forward·명시 저장 선택 우선 | 병합 전체를 임의 undo로 표현하지 않기. 연관 자료 preview·경합·새 역작업 계획과 영향 검증 | E03,E06 |
| A12 생존/추천 제외 | 영업 상태 확인·회수/해제 | ADMIN 케이스 판정, 자동 제외 해제 기능 존재 | 전체 해제의 대상/건수 고정·추가 인증·preview. 공개/폐업/추천제외를 별개 상태로 보여줌 | E03 |
| A13 방문/사진 검수 | 승인·보완·반려·공개 회수 | ADMIN 서버/DB guard, 현재 version·4개 확인·immutable transition. 본인 수정/철회는 소유자 | 대기 SLA·대상별 감사 연결·삭제 대기 관측. 일괄 승인과 과거 내용 자동 재공개는 미구현 | E04,E07 |
| A14 사진 삭제 | 본인 철회·계정 탈퇴·재시도 | 소유자/탈퇴 처리에서 정확 key DELETE 계획, 실패 재시도. ADMIN 회수는 파일 보존 | privacy 작업자에게 한정한 대상 preview/실행/완료 확인. 공개 회수와 영구 삭제를 혼동하지 않는 UI | E07,E09 |
| A15 평가 설정 | 현재 규칙·버전 확인 | active rating config 읽기. 일반/REVIEWER source 분리·epoch/revision 적용 | 규칙 변경 proposal→합성 비교→승인→버전 활성화. 기존 수치와 원장 직접 덮어쓰기 금지 | E08 |
| A16 평가 작업 | 재계산 접수·완료·실패 | ADMIN 수동 enqueue 후 전역 PENDING 1건 처리, 완료 문구 출력 | **요청한 장소/job의 결과를 확인한 뒤 완료 표시**. 현재 processor 결과와 다른 job 처리가 UI 완료와 혼동될 수 있음 | E08 |
| A17 조작 사건 | 검토·확정·표 무효화 | ADMIN, 사유·audit·원본 보존, invalidation + 재계산 | 사건 subject와 대상 표 연결 검사, version/CAS, 중복 처리 결과, 재개/복원 절차 | E08 |
| A18 guest/개인화 | 승계 실패 확인·사용자 선택 보호 | guest 소유권/만료/50곳, 회원 명시 선택 우선, 성공 batch 정리·실패 원본 유지 | 원문 cookie 없이 상태 코드·처리시각 관측. 관리자 임의 타인 세션 병합·취향 대행 변경 금지 | E10 |
| A19 개인정보 요청 | 열람·정정·삭제·탈퇴 접수 | 자기 탈퇴·일부 삭제/익명화 경로. 자유 문안·관계키·검수 이력은 남음 | 본인 확인·범위/법적 보존 결정·추출 preview·처리 기한·실패 재시도. 전체 익명화/삭제 완료 과장 금지 | E09,E10,E16 |
| A20 보존 정리 | 만료 자료·정리 결과 조회 | guest/product event/rate window 정리와 사진 cleanup은 기존 maintenance | 대상 종류별 dry-run·건수·결과·실패 대기열. 보유기간 변경은 정책 결정/별도 migration 검토 | E10,E11 |
| A21 원장 정합성 | 읽기 감사·누락 탐색 | ADMIN `/admin/audit`, 최대행 상한·INCOMPLETE 표시, 자동 수정 없음 | snapshot SHA/sourceCommit·감사 실행 비교·finding 처리 추적. 감사 결과에서 직접 무제한 DB 수정 금지 | E12 |
| A22 관리자 감사 | 누가 무엇을 바꿨는지 조회 | 도메인별 admin_audit_logs/전환 이력 기록, 통합 조회 화면 없음 | 작업/대상/actor/결과 cursor 검색, 제한된 export, 보존·접근 감사. 자유 문안과 secret 최소화 | E02,E04,E05,E07,E12 |
| A23 공공데이터 | 수집 시작·진행·실패·재개 | ADMIN 수동 동기화, 정기 최대5페이지, 오래된 RUNNING 회수·실패 이어받기 | 구체 job ID/외부 호출/건수/대상 preview, 중복 방지·안전한 취소·재시도·일괄 실행 한도 | E11 |
| A24 NAVER/지도 | 지역별 사용량·검증·geocode | 지역 pack 예산/사용량 조회, 서버 quota·기능 env 검사, 일부 관리 작업 | 사용량과 실제 청구 구분, 원자적 동시 예약·remaining, 증가 승인/감소 즉시반영 설계 | E03,E13 |
| A25 AI/부가 공급자 | 모델/호출·비용·실패 관측 | 제한된 AI helper와 과거 token/추정 사용량 컬럼. 통합 비용 콘솔 없음 | 원문 prompt/응답·secret 대신 모델/규칙 버전·건수·추정/실측 구분. 임의 모델/공급자 추가·자동 호출 확대 금지 | E13,E15 |
| A26 주차/EV·코스 | 데이터 신선도·동기화·fallback | 기존 분기와 정기 주차/EV 동기화, 정해진 page/주기·키 존재 검사 | 소스별 마지막 성공/실패/부분 자료·작업 관측. UI에서 새 공급자나 스케줄 임의 추가 금지 | E11,E13 |
| A27 feature/kill switch | 값 조회·긴급 중단·재활성화 | env/source flag 소비. CST 점검 fence는 HTTP503과 새 cron 핸들러 진입 차단이며 이미 실행 중인 작업을 취소하지 않음. 전역 flag 편집 UI 없음 | 선언된 key/type/scope allowlist만, 감소/중단과 확대/재개 권한 구분, version·만료·복구·배포값/실효값 구분. 전면 fence 중에는 앱 UI로 우회 해제하지 않음 | E11,E13,E15 |
| A28 정기/수동 작업 | 다음 실행·진행·취소·회복 | Worker의 두 cron 분기; maintenance는 여러 작업의 Promise.all. 개별 통제판 없음 | 기존 cron 안의 작업 registry·상태·lease·협조적 취소 설계. 실행 중 외부 효과를 중단 완료로 오표시하지 않음 | E11 |
| A29 RSI | 고정 공개 경로 점검·결과 조회 | ADMIN POST와 토큰 보호 내부 GET, flag·고정 origin/경로, 로그/일부 audit | 마지막 성공/실패·감사 연결·중복/호출 한도·권한 분리. R4 코드 생성/승격과 공개 경로 self-check 구별 | E14 |
| A30 경보/장애 | 오류 조회·해결 처리·인계 | ADMIN 운영 경보 조회와 사유로 resolve. 외부 메일 연결은 미확정 | ACK/조사/해결/재개 구분, 해결 근거·담당·연관 job, 버전/CAS, 실제 복구 검사 후 닫기 | E02 |
| A31 백업/복구 | 백업 상태·복원 계획·정합 검증 | 운영 런북과 local D1 복구 rehearsal 도구. 운영 백업 콘솔/복구 성공 증거 아님 | 백업 소유/기한/무결성·복구 대상 확인·격리 rehearsal·RPO/RTO 결정. 운영 덮어쓰기는 별도 PR 실행 | E15 |
| A32 배포/환경 | 변경 승인·배포/복구 상태 추적 | feature PR→main→지정 운영 도구. 앱 내 배포/secret 편집 경로 없음. 0040 이후 구 Worker 단순 rollback 금지 | PR/commit/Worker/schema/실효 flag·live RSI 증거 연결. 전면 fence 또는 같은 스키마 전진 수정. UI 임의 deploy·migration·secret 읽기 금지 | E15 |
| A33 서비스 문안/신고 | 법적 문안·안내·문의 접수 | privacy/terms는 코드·PR 변경, 일부 제안/정정 접수 | 버전·검토자·시행일·미확정 표시. 필요하면 제한된 안내 draft/preview/publish 검토; 임의 HTML/CMS 추가는 별도 판단 | E16 |
| A34 메일 도메인 | 지정 발신 도메인 상태·생성·검증 | ADMIN GET/동일 origin POST, 설정된 단일 도메인·허용 action, 외부 변경 전 REQUESTED audit | 제공자 결과/재시도·최근인증·실제 발신 가능 검증 연결. 임의 DNS 편집·외부 도메인 관리·API key 표시 금지 | E17 |

추가 조사/회귀 우선 항목은 A09(확인 POST/공개), A16(선택 job의 실제 완료), A17(사건-표 결속), A22(감사 원자성/조회)다. 코드상 차이를 계획의 안전 선행조건으로 기록한 것이며 이 문서에서 기능을 수정하지 않았다.

## 4. 화면과 작업 계약 제안

관리자 홈은 **운영 현황 / 콘텐츠 / 사람·권한 / 검수·평가 / 작업·공급자 / 개인정보·감사 / 배포·복구 기록**으로 나눈다. 메뉴별 검색·cursor·빈/실패/권한없음/갱신중 상태를 갖고, 전체 수치와 현재 페이지 수치를 구분한다. 회원 원문이나 비밀값을 홈 요약으로 끌어오지 않는다.

위험 작업 화면은 `대상 선택 → 현재 상태/영향 preview → 사유·필요한 재인증/승인 → 제한된 실행 → job 결과 → 재조회/복원` 순서다. 다음은 제안 공통 계약이다.

| 위험도 | 예시 | 제안 실행 조건 | 성공·복구 기준 |
|---|---|---|---|
| R0 읽기 | 집계/작업상태/정합 감사 | 현재 역할·민감 필드 최소화·no-store | 출처/시각/상한/불완전 표시, 읽기로 변이하지 않음 |
| R1 단일 가역 변경 | 분류 보완·경보 ACK | 동일 origin·작업 권한·schema·사유·version | 실제 변경 행과 감사 연결, 409에는 덮어쓰기 금지 |
| R2 공개/권한/비용 변경 | 공개·회수·사용량 상한 확대·세션 회수 | R1 + 최신 preview + 최근 재인증·엄격 한도 | 대상별 완료/부분 실패, 사용자 선택·원장 보존, 명시 역작업 |
| R3 삭제/운영 복구 | 개인정보 삭제·운영 DB복원·배포 | R2 + 해당 PR의 명시 운영 승인·대상/백업/중단창 확인. 중요 작업은 승인자와 실행 책임 기록 | 외부 결과·불명 상태 재확인, 실패/rollback 증거. 관리자 UI를 통과했다는 이유로 인프라 권한 부여 금지 |

2인 검토가 가능한 조직에서는 R3의 독립 검토를 우선한다. 가용 인원을 만들어 적지 않으며, 독립 검토 불가 시 사용자 지정 운영 책임·사전 승인 PR·기록 가능한 실행 절차로 대체할지 결정한다. 마지막 ADMIN 제거·자기 무제한 승격·본인 승인만으로 권한 확대하는 우회는 허용하지 않는 방향이다.

### 설정과 작업의 소유권

- 초기에는 현재 env/source 설정을 **읽기 상태·존재 여부·기대/실효값·변경 PR 링크**로 노출하는 단계부터 시작한다. API key나 token 값은 입력 재표시/감사/export 대상이 아니다.
- 동적 flag가 필요하면 scope·기본값·강제 중단 우선순위·만료·cache 무효화·DB 장애 시 fail-closed를 ADR로 먼저 정한다. DB 설정 테이블이 필요하다는 사실을 현재 구현으로 표기하지 않는다.
- 공급자 quota·작업 registry·삭제 요청 등 새 영속 구조는 각 후속 PR에서 필요한 최소 migration과 기존 이력 호환/forward-fix를 검토한다. 기존 테이블의 존재가 사용 확대 승인이라는 뜻은 아니다.
- 신규 cron/Queue/DO를 전제로 하지 않는다. 기존 실행 경로에서 추적·한도·중복 방지를 먼저 해결하고, 부족하다는 측정이 있을 때 거버넌스를 거친다.
- 자동 R4 제안/검증/승격은 별도 운영 pipeline이다. ADMIN 공개 self-check 버튼에 코드 실행·auto-merge 권한을 결합하지 않는다.

## 5. 우선순위·의존성·공수와 후속 Issue backlog

아래 제목은 **아직 열지 않은 후속 Issue 초안**이며 완료된 기능이 아니다. #399는 이 계획의 추적 Issue다. 공수는 1인 개발·통합·의미 있는 검증을 포함한 추정 범위로, 실제 계약/인력 가용성 약속이 아니다. 각 Issue는 1–2시간 단위 checklist로 나누고 한 PR의 소유 파일을 가급적 5개 이하로 제한한다.

| 순서/제안 Issue 제목 | 우선/추정 | 선행 | 완료 기준과 주요 예상 소유 |
|---|---|---|---|
| B01 `admin: 대상·작업·현재 권한 registry와 운영 홈` | P0 / 8–12h | 계획 수용 | A01~34의 현재/없음/운영미확인 표시, 메뉴·집계 상한·읽기 권한. `admin-index`, 운영 dashboard/UI |
| B02 `admin: 위험 작업 공통 preview·version·감사 계약` | P0 / 12–16h | B01 | 동일 target/version 실행, 사유/한도·중복키·결과불명·감사 실패 부정시험. 공통 server/action·schema 설계 |
| B03 `admin: 재인증·권한 부여/회수·마지막 관리자 보호` | P0 / 12–20h | B02, auth ADR | 기존 로그인 방식별 재인증, 우회/기한·자기승격/마지막계정 보호·세션권한 회귀. auth/관리자 관리 |
| B04 `admin: 요청한 재계산 job의 결과를 표시` | P0 / 4–6h | B02 | 다른 PENDING job 처리와 구별, 실패/queued를 완료로 표시하지 않음. `admin-ratings`, recompute |
| B05 `admin: CSV 확인과 사건-표 결속 안전 보완` | P0 / 8–12h | B02 | CSV 크기/행 상한·preview변조·stale확인, 다른 사건/표 invalidation 거절. CSV와 평가를 별도 PR로 분할 |
| B06 `admin: 통합 audit cursor·작업 이력·민감필드 정책` | P1 / 8–12h | B02 | actor/대상/job 연계, cursor·권한·redaction·상한·export감사. audit 조회/도메인 감사 연결 |
| B07 `admin: 회원 검색·접근 제한·세션 철회` | P1 / 8–12h | B03,B06 | 최소필드 조회, 본인/타인·역할변경·탈퇴·세션철회 회귀. 회원 관리 route/service |
| B08 `admin: 리뷰어·학생 관리의 경합과 일괄 결과` | P1 / 8–12h | B02,B03,B06 | 신청 근거/current version·일괄 부분성·초대 비밀값 재표시0·seat/owner 보존. 두 도메인은 별도 PR |
| B09 `admin: 장소 공개·병합·회수 영향 preview` | P1 / 10–16h | B02,B03,B05,B06 | 출처/현재값 구분, 건수고정·역작업·GENERAL/저장우선·사진/평가회수 회귀. 장소 운영 |
| B10 `admin: 작업 상태·lease·제한 재시도/취소` | P1 / 12–18h | B02,B04,B06 | cron/수동 동시실행·stale lease·재시작·외부결과불명 구분, 기존 cron 사용. 작업별 순차 PR |
| B11 `admin: 공급자 사용량·예산·메일 도메인 상태` | P1 / 10–16h | B03,B06,B10 | NAVER/공공/주차/AI 호출 상한·추정/실측·원자 quota, A34 지정 메일 도메인의 접수/검증/결과불명 재조회. credential 값0, 임의 endpoint/DNS0 |
| B12 `admin: flag 기대/실효값과 제한된 kill switch` | P1 / 8–12h | B03,B06,B11, 설정 ADR | allowlist·version·fail-closed·긴급중단/재활성화 분리·복원. 첫 PR은 읽기 전용 |
| B13 `admin: 개인정보 요청·사진 삭제 대기 운영` | P1 / 12–18h | B03,B06,B10, #360 실제 정책 | 대상/권리·원본/이력/법정보존 구분, 정확key·실패재시도·복원불가 경고·완료증거. 실제 기간 임의 생성0 |
| B14 `admin: 장애·RSI·배포·백업의 증거 연결` | P1 / 8–12h | B06,B10,B12 | 고정 self-check·경보상태·배포 SHA/실효설정/백업무결성 연결. A34 요청 접수≠도메인 검증 완료≠실제 발신 성공을 표시. 발신 등 실행은 승인된 운영경로 유지 |
| B15 `admin: 평가 설정 version과 변경 영향 비교` | P2 / 8–12h | B02,B03,B06, DEC-03 유지 | 현재 산식 유지·합성 전후 비교·version 활성화/복원. 원시표 재작성0 |
| B16 `admin: 제한된 데이터 export·안내 문안 변경 경로` | P2 / 6–10h | B03,B06,B13 | 최소필드·기간·접근감사·CSV formula injection 방지, 문안 draft/시행일·PR검토. 원문 일괄노출0 |
| B17 `admin: 운영 rehearsal·인계·통합 수용` | P2 / 12–18h | B01~16 해당 범위 | 권한/중복/실패/삭제/복구 end-to-end, desktop/mobile/키보드, 실제 운영증거와 합성 구분 |

합계는 **154–234시간**, 계획 완충 25%(시간 단위 올림) **39–59시간**, 총 **193–293시간**이다. 집중 6시간/평일 가정이면 약 **33–49평일**의 추가 범위다. A34 메일 도메인 상태·결과 확인 보완의 2–4시간은 B11에 포함했다. 새 사실 조사·정책 결정 대기와 실제 운영 리허설 창은 별도이며, 순수 구현 시간을 기다림으로 채우지 않는다. 첫 안전 단위 B01/B02/B04/B05는 32–46시간(완충 전)이며 전 기능 완성과 구분한다. 기존 구현을 재사용하더라도 아직 입증하지 않은 작업/개인정보/복구 경계가 많아 전체를 며칠로 약속하지 않는다.

**핵심 경로:** B01 → B02 → B03/B06 → B10/B11 → B12/B13 → B14 → B17. 콘텐츠 보완 B05/B09와 사람 관리 B07/B08은 공통 계약을 확정한 뒤 분담 가능하지만, 동일 auth/schema/audit 파일 수정과 migration 순번은 순차 통합한다. 실운영 개인정보 처리(B13)는 #360 실제 정책이 필요하다. 설계/합성 부정시험은 그와 독립해서 진행할 수 있다.

B08/B09/B11/B15의 읽기·설계·합성 비교는 선행할 수 있지만, 권한/공개/비용 확대·설정 활성화의 변이 수용은 B03 재인증 계약을 갖춘 뒤 진행한다. 기존 위험 경로를 제한하는 B05 안전 보완은 그보다 먼저 진행할 수 있다.

각 2–3개 Issue 뒤 현재 경계표·공수·회귀 결과를 갱신한다. 12/10에 포함할 항목은 사용자에게 구체 범위/공수 차이를 제시하고 상위 SSOT의 기존 필수 준비 작업을 훼손하지 않는 선에서 별도 확정한다. 전체 계획 완료 기한은 아직 미정이다.

## 6. 수용 기준과 필수 시험

후속 구현 PR에는 해당 작업만을 검증하는 의미 있는 시험을 넣는다. 이 문서 작성 때문에 local unit/integration/E2E suite를 실행하지 않는다.

| 게이트 | 필수 검증 | PASS의 의미 |
|---|---|---|
| G1 권한 | 익명/USER/REVIEWER/학생 seat/ADMIN × 허용·금지 작업, 직접 POST·ID 변경·세션회수·최근인증 만료 | UI와 무관하게 서버가 거절, 민감필드/다른 사용자 자료0 |
| G2 변경 안전 | preview 뒤 대상/역할/version 변경, 두 관리자·cron 동시실행, 중복 클릭·응답 유실·감사 실패 | 최신 데이터 덮어쓰기0, 단일 실행 또는 설명 가능한 부분 결과, 재시도 범위 고정 |
| G3 공개 정합 | 보류/반려/철회/강등/삭제대기 × 목록·상세·사진 GET/HEAD·프로필·평가·추천·trust/epoch | 승인되지 않은 효과0, GENERAL 원본·회원 명시 선택 보존 |
| G4 비용/작업 | 동시 quota 접근, 한도초과, provider 실패·지연·결과불명, pause 후 재개·lease 만료, 메일 도메인 요청 접수/검증/발신 상태 | 허용 호출 상한, 결과불명 중복변이0, 시작/완료 증거와 source 구별. 도메인 verify 접수를 실제 발신 성공으로 표시하지 않음 |
| G5 삭제/복구 | 계정 표시정보 대체와 자유문안 보존 구분, 정확key R2 실패, backup 손상·잘못된 대상·새 version | 부분 삭제를 전체완료로 주장0, 격리 복원 digest/정합 검증, 운영 덮어쓰기 별도 승인 |
| G6 UI/접근성 | desktop/mobile, 320px/200%, 키보드, SSR 초기화·오류/빈/부분 상태, 위험 대상 preview | 클릭 유실·다른대상변경0, 오류입력 보존, 명확한 대상/사유/건수·상태 표시 |
| G7 운영 | 병합 main/대상 Worker·schema·실효flag·지정창·rollback과 실제 live RSI | 코드/CI/배포/실행/실증 증거가 각각 존재. 한 종류로 다른 종류 대체0 |

현재 테스트 재사용 후보: `reviewer-moderation`, `reviewer-public-consumers`, `reviewer-photo-deletion`, `student-*`, `guest-*`, `rating-recompute`, `record-audit`, `admin-rsi-check`의 integration과 `admin-*`, `reviewer-moderation`, `guest-save-merge` E2E. 존재한다는 이유만으로 새 권한/운영 시나리오를 이미 통과했다고 적지 않는다.

## 7. 결정 대기와 완료 판정

- 작업별 위험도/세부 권한·최근인증 방식/유효시간·마지막 관리자 복구 책임은 후속 auth ADR에서 확정한다.
- 보유기간·법적 근거·문의처·실제 운영주체·RPO/RTO·복구창·외부 비용 한도는 사실 입력/정책 결정이 필요하다. 현재 코드의 숫자를 계약 SLA로 바꾸지 않는다.
- “공개중단”은 향후 서버 조회 차단이지 이미 내려받은 자료의 원격 회수가 아니다. “삭제”는 사진/원장/감사/백업 각각의 상태로 확인한다.
- 이 계획의 문서 완료는 A01~34의 담당 경로·gap·우선순위·시험이 식별되고 독립 리뷰를 통과한 때다. ADMIN 기능 완료는 수용한 backlog별 G1~G7와 운영 증거를 충족한 때이며, 미수용/미구현/운영미확인은 계속 표시한다.

## 8. 소스 근거 인덱스

모든 경로는 위 기준 commit의 코드다. 라이브 설정 값·토큰·운영 계정 식별자는 복사하지 않았다.

| 근거 | 파일·확인한 경계 |
|---|---|
| E01 | [routes](../../app/routes.ts), [session](../../app/features/auth/session.server.ts) `getOptionalUser/requireAdmin`, [guards](../../app/features/auth/guards.server.ts), [admin-index](../../app/routes/admin-index.tsx) |
| E02 | [admin-operations](../../app/routes/admin-operations.tsx), [dashboard](../../app/features/operations/dashboard.server.ts), [alerts](../../app/features/operations/alerts.server.ts) |
| E03 | [admin-places](../../app/routes/admin-places.tsx), [CSV route](../../app/routes/admin-import.tsx), [CSV parser](../../app/features/places/import.server.ts), [place repository](../../app/features/places/place.server.ts), [place operations](../../app/routes/admin-place-operations.tsx), [publication](../../app/features/places/place-review-publication.server.ts), [legacy redirect](../../app/routes/admin-candidates.tsx) |
| E04 | [reviewer admin](../../app/routes/admin-reviewers.tsx), [reviewer service](../../app/features/reviewers/reviewer.server.ts) |
| E05 | [student admin](../../app/routes/admin-students.tsx), [invitations](../../app/features/students/invitations.server.ts), [student work](../../app/features/students/admin.server.ts), [task ownership](../../app/features/students/tasks.server.ts), [student HTTP](../../app/features/students/http.server.ts) |
| E06 | [merge/revision](../../app/features/places/place-merge.server.ts), [recall](../../app/features/places/place-publication-recall.server.ts) |
| E07 | [visit admin](../../app/routes/admin-reviewer-visits.tsx), [moderation](../../app/features/ratings/reviewer-moderation.server.ts), [public eligibility](../../app/features/ratings/reviewer-publication.server.ts), [photo access](../../app/features/ratings/reviewer-photo-access.server.ts), [photo cleanup](../../app/features/ratings/reviewer-photo-deletion.server.ts), [0040](../../drizzle/0040_reviewer_moderation.sql) |
| E08 | [rating admin](../../app/routes/admin-ratings.tsx), [active config](../../app/features/ratings/rating-config.server.ts), [jobs](../../app/features/ratings/recompute.server.ts), [integrity](../../app/features/ratings/integrity.server.ts) |
| E09 | [account](../../app/features/auth/account.server.ts) `registerAccount/resetPassword/withdrawAccount`, [Google](../../app/routes/auth-google-callback.tsx), [NAVER](../../app/routes/auth-naver-callback.tsx) |
| E10 | [guest saves](../../app/features/onboarding/guest-saves.server.ts), [guest merge](../../app/features/onboarding/guest-merge.server.ts), [lifecycle](../../app/features/onboarding/data-lifecycle.server.ts), [0041](../../drizzle/0041_guest_saved_places.sql) |
| E11 | [worker](../../workers/app.ts), [scheduled candidates](../../app/features/candidates/scheduled-sync.server.ts), [manual sync](../../app/routes/admin-data-sync.tsx), [scheduled ratings](../../app/features/ratings/scheduled-rating.server.ts), [scheduled parking](../../app/features/parking/scheduled-parking.server.ts) |
| E12 | [read-only audit](../../app/routes/admin-audit.tsx), [audit source](../../app/features/audit/record-audit.server.ts), [schema](../../app/db/schema.ts) |
| E13 | [region quota](../../app/features/places/naver-region-quota.server.ts), [region pack](../../app/features/regions/region-pack.ts), [declared env keys](../../app/cloudflare-env.d.ts), [AI helper](../../app/features/candidates/ai-category-verifier-v2.server.ts), [historical usage fields](../../drizzle/0008_ai_usage_quota.sql) |
| E14 | [admin RSI](../../app/routes/admin-rsi-check.ts), [self-check](../../app/features/operations/rsi-self-check.server.ts), [fixed paths](../../app/features/operations/rsi-self-check.ts), [RSI promotion](../../scripts/rsi/promotion.ts) |
| E15 | [local recovery tool](../../scripts/cst-local-d1-recovery.mjs), [local runbook](../operations/cst-local-d1-recovery.md), [deployment runbook](../operations/cloudflare-deploy.md), [CST rollout](../operations/2026-11-14-cst-production-rollout.md), [deployment fence](../../app/features/operations/deployment-fence.ts), [package scripts](../../package.json) |
| E16 | [privacy](../../app/routes/privacy.tsx), [terms](../../app/routes/terms.tsx), [data inventory](../legal/privacy-data-inventory.md), [actual facts #360](https://github.com/taejunyun1/Tasted_it/issues/360) |
| E17 | [email domain admin](../../app/routes/admin-email-domain.ts), [domain service](../../app/features/auth/email-domain.server.ts) |
