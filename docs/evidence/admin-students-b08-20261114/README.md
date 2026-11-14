# B08 학생 관리 화면 검증

2026-11-14, 격리된 로컬 D1의 합성 QA 계정으로 확인했다. 운영 계정·초대·메일은 사용하지 않았다.

- 최종 대상 표시 연결 후 새 B08 시나리오가 desktop/mobile에서 2/2 통과했다. 미리보기 대상 셀에 `학생 A`가 표시되는지 확인했다. 아래 이미지 4장은 이 최종 실행 결과다.
- 앞선 소스 고정 검증에서 새 B08 부정 시나리오와 기존 JavaScript 비활성 초대 발급 양성 시나리오가 desktop/mobile 각각 통과했다(4/4).
- 기존 학생 workspace·request-session·invite-handoff 3개 smoke 파일은 Chromium 13/13 통과했다.
- 새 시나리오는 JavaScript 없이 미리보기를 열고, 아직 변경되지 않았다는 안내·대상·처리 예정·재인증 복귀 링크를 확인한다. 최근 인증이 없는 확정 요청은 재인증으로 이동한다.
- 관리자 HTML GET 및 잘못된 intent의 document POST 400 응답에 `private, no-store`와 `Vary: Cookie`가 적용되는지 확인한다.
- 아래 화면 4장을 직접 판독했다. 데스크톱과 모바일에서 내용·버튼이 겹치거나 잘리지 않았고 가로 넘침 검증도 통과했다. 모바일 표는 항목별로 세로 배치된다.
- 원문 초대 링크는 이 미리보기 화면에 없으며, 발급 응답에만 표시한다는 안내가 보인다. 이 이미지들은 운영 배포나 실사용자 초대 증거가 아니다.

| 화면 | Desktop | Mobile |
|---|---|---|
| 학생 관리 | [보기](student-management-desktop.png) | [보기](student-management-mobile.png) |
| 초대 미리보기 | [보기](student-preview-desktop.png) | [보기](student-preview-mobile.png) |

소스 수정과 겹친 Vite HMR 실행 중 응답 유실(`-1`)이 한 차례 관찰됐으며, 소스 고정 후 위 검증에서는 재현되지 않았다.

시나리오: `tests/e2e/admin-students-b08.spec.ts`, `tests/e2e/student-workspace.spec.ts`, `tests/e2e/student-request-session.spec.ts`, `tests/e2e/student-invite-handoff.spec.ts`.
