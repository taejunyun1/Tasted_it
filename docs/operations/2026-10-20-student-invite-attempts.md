# 학생 초대 수락 실패 진단 보존

## 배경과 증거 한계

2026-10-20 저장 로그를 기존 Cloudflare 대시보드 세션으로 조회했다. 기존 API OAuth는 로그 조회에 403을 반환하지만, 대시보드 조회는 가능했다. Worker 로그는 10% 샘플링이며 특정 수락 POST 두 건의 원문은 발견되지 않았다. 전날의 `GET /student.data`에서 확인한 `STUDENT_ACCESS_DENIED`를 해당 POST의 원인으로 간주하지 않는다. 과거 두 요청의 정확한 원인은 계속 미확정이다.

학생의 재시도 시간이 미정이므로, 이후 인증된 수락 실패를 기존 `admin_audit_logs`에 보존한다. 이 변경은 수락 조건이나 기존 초대의 유효성을 변경하지 않는다.

## 기록 범위

- `student-join`의 로그인, 동일 출처, 폼 검증, 기존 JOIN 횟수 제한을 통과한 요청만 대상이다.
- 수락 성공은 기존 `STUDENT_INVITE_ACCEPTED` 기록을 그대로 사용한다.
- 실패는 `STUDENT_INVITE_FAILED`, `STUDENT_WORKSPACE`로 기록한다. `actor_user_id`는 현재 인증 계정이며, `target_id`는 해당 좌석 또는 `join`이다.
- `after_state`에는 `reason`, `status`, `seatCode`만 저장한다. 초대 코드/해시, 이메일, 이름, 쿠키, IP, 요청 본문, 원문 오류는 저장하지 않는다.
- 사유는 초대 없음·만료·취소·이미 사용, 계정 부적격·이미 좌석 연결, 좌석 비활성·만료·이미 연결, 동시 점유 충돌·예상하지 못한 실패로 제한한다.
- 원인 분류는 실패 직후 데이터 상태의 관찰이다. 동시 요청으로 상태가 바뀔 수 있으므로 과거 상태에 대한 완전한 인과 증명으로 표현하지 않는다.
- 기존 요청 제한으로 계정당 15분에 최대 10개 실패 감사행이 생성된다. 429와 검증 전 실패는 감사행을 추가하지 않는다.
- 진단 저장 자체가 실패하면 `STUDENT_INVITE_AUDIT_FAILED`만 경고하고 원래 응답을 유지한다. 이 경우 보존 성공으로 보고하지 않는다.

## 운영 확인

새 수락/실패를 기존 5분 감시에서 다음 SELECT로 읽는다. `after_state`의 정의된 필드만 사용하고 계정과 좌석을 추측으로 연결하지 않는다.

```sql
SELECT id, target_id, after_state, created_at
FROM admin_audit_logs
WHERE target_type = 'STUDENT_WORKSPACE'
  AND action = 'STUDENT_INVITE_FAILED'
ORDER BY created_at DESC
LIMIT 50;
```

`target_id = 'join'`이면 초대가 특정되지 않은 실패다. 수락 실패 기록과 성공 기록은 별도의 이벤트 키로 중복 통지를 방지한다. 실제 학생 과제 열기 성공은 연결 상태만으로 확정하지 않으며, 인증된 요청 또는 제출 증거를 따로 확인한다.

## 배포·비용·복원

대상은 지정 운영 계정의 `retaste-beta` 및 기존 D1이다. 새 migration, 테이블, binding, cron, 공급자, 의존성, API 권한, 로그 샘플링 설정 변경은 없다. 실패당 제한된 D1 읽기와 감사행 1개를 추가하고, 기존 감사 데이터의 접근·보존 정책을 따른다. 기존 초대 4개·좌석 4개·과제 56개를 재발급/수정하지 않는다.

병합된 main에서 `pnpm run build` 및 `pnpm exec wrangler deploy --profile tastedit-production`를 실행한다. 배포 전후 원격 SELECT로 좌석·초대·과제 digest를 대조하고 기존 관리자 RSI 6경로 점검을 수행한다. 실제 학생을 대신해 초대를 수락하지 않는다. 불가피한 운영 합성 검증은 기존 운영자 계정에서 존재하지 않는 토큰으로 1회만 수행하며 기존 학생 초대를 소비하지 않는다. 이때 생성되는 진단 행은 운영자 합성 검증으로 구분하고 학생 실적으로 집계하지 않는다.

문제 발생 시 직전 Worker `f8081cd6-5f6c-4679-8347-b36179b1e61b`로 복원한다. 감사행은 삭제하지 않으며 과거 미저장 로그를 복원했다고 주장하지 않는다.
