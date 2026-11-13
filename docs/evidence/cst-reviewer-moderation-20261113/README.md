# CST 방문 리뷰 제출·검수 UI 검증

2026-11-13, #359 / #354. 정책 #366과 backend #382를 연결한 UI의 로컬 합성 검증이다. 운영 배포·원격 D1·실제 학생/리뷰어 자료·사진 기능 활성화·메일·유료 요청은 수행하지 않았다. `wrangler.jsonc`의 사진 업로드 값은 `false`이며, 격리한 `wrangler.e2e.jsonc`에서만 `true`다.

## 기준과 검증 결과

- backend #382의 동결 head `af42310`을 preview 통합한 뒤, squash 병합 `3bc7758` 및 후속 main #386 `1c31bc1`, #387 `be2236b`를 보존하며 통합했다. 동결 backend와 squash main의 평가·사진·공개 gate 소스가 같음을 대조했다.
- 관련 E2E 28건 PASS, 2.1분: 검수 2종·사진 7종·평가 기반 2종·기존 리뷰어 관리 3종의 desktop/mobile 조합. 이후 native POST 안내를 보완하고 아래 최종 6건을 별도로 검증했다.
- 최종 `reviewer-moderation.spec.ts` 3종 × desktop/mobile = **6건 PASS**, 1.3분. 실제 공개 전이, native POST, 초기 client entry 지연을 각각 독립 시험으로 실행했다.
- UI 단위 시험 10건 PASS (`--maxWorkers=2`). 기존 backend 전체 integration 결과 534 PASS는 #382의 증거이며 이번 UI 실행 수에 합산하지 않는다.
- 최신 main #387 통합 뒤 `pnpm run typecheck` / `pnpm run build` PASS.
- `BASE_URL`을 지정한 원격 실행 방어 시험은 검수·사진 10건 모두 SKIP. 원격 환경에서 합성 제출 시험을 수행하지 않는다. 새 anonymous/admin context에도 지도 공급자 요청 차단을 적용했다.
- `pnpm audit --prod`: 취약점 0. 전체 audit는 기존 개발 의존성 전이 경로 46건(low 4 / moderate 26 / high 15 / critical 1)이며 이 PR은 의존성·lockfile을 바꾸지 않는다.

실행 명령:

```sh
pnpm exec playwright test tests/e2e/reviewer-moderation.spec.ts tests/e2e/reviewer-photo-upload.spec.ts tests/e2e/rating-foundation.spec.ts tests/e2e/reviewer-management.spec.ts
pnpm exec playwright test tests/e2e/reviewer-moderation.spec.ts
pnpm exec vitest run tests/unit/reviewer-visit-components.test.ts tests/unit/reviewer-moderation-components.test.ts --maxWorkers=2
```

## 실제로 확인한 경계

| 흐름 | 확인 결과 |
| --- | --- |
| 본인 제출 | 방문일·방문 근거·이해관계, 사진별 촬영일·권리·설명·노출 확인을 직접 입력한다. 제출 결과는 검수 대기이며 즉시 공개로 안내하지 않는다. |
| 비공개 자료 | 익명 사진 GET/HEAD·preview 요청 404, 비관리자 검수 POST 403. 본인 preview URL과 제출 상태를 표시한다. |
| 보완·승인 | 관리자 보완 사유가 본인에게 보인다. 본인 입력 오류와 관리자 확인 누락은 안내 후 재시도하며, 승인 후에만 공개 프로필의 사진·평가·장소 연결과 사진 GET 200을 확인한다. |
| 수정·회수·삭제 | 승인된 자료를 본인이 수정하면 다시 검수 대기로 바뀌고 공개 프로필·사진 URL에서 사라진다. 재승인 후 관리자 회수로 다시 공개가 중단되며, 본인 철회 후 preview 사진도 404다. |
| 공개 데이터 | 작성자 내부 ID·사진 권리 근거·비공개 방문 근거가 공개 프로필 HTML에 없음을 확인한다. |
| 사진·초안 | 사진 교체 시 이전 날짜·권리·개인정보 확인을 재사용하지 않는다. 장소 변경 시 해당 선언을 초기화한다. JPEG 재준비·EXIF 제거·중복 제출 방지·선택 저장소 차단·키보드 흐름을 검증한다. |
| 이전 기록 | 본인 12건/관리자 50건 cursor 연결을 제공한다. 잘못된 cursor 400, 유효 cursor의 최근 기록 복귀와 관리자 `ALL` 필터 유지를 실측한다. 동일 시각 ID 정렬·누락/중복 경계는 #382의 데이터 계층 회귀와 구분한다. |

활동 중단/역할 변경 소유자의 철회, 삭제 대기 시 수정 숨김, 확인되지 않은 이해관계의 승인 차단, 본인 식별자와 현재 version 연결은 UI 단위 시험과 backend 계약 검토로 확인했다.

## 초기 client 준비와 native POST

초기 조사에서 첫 문서와 client entry는 200이었지만, 최적화된 React DOM·Router 의존성이 `504 Outdated Optimize Dep`로 실패했다. 다음 문서에서는 장소 선택·다음 버튼 클릭이 성공한 bootstrap 의존성 요청보다 먼저 시작됐다. 이 순서는 JS 준비 전 SSR 버튼의 클릭이 유실되는 경로와 일치한다. 재최적화가 발생한 이유는 **UNKNOWN**이며 #365의 기존 CI legal 실패와 같은 원인이라고 결론내리지 않는다.

실제 entry 요청을 barrier로 보류하는 회귀 시험은 준비 전 장소 버튼이 enabled여서 RED였다. 기존 hydration 상태로 JS 전용 wizard 입력·선택·단계를 잠그고 `화면 준비 중` 안내를 추가한 뒤, 동일 요청 보류 중 disabled → 요청 해제 후 enabled → 실제 선택과 다음 단계 반영을 desktop/mobile에서 GREEN으로 확인했다. Vite 설정·기대값·timeout·retry는 바꾸지 않았다.

관리자 native POST는 JS 비활성 context에서 별도로 검증한다. 버튼의 visible/enabled·양수 rect, 사유 필드의 HTML required, 확인 checkbox의 HTML required 부재, `form.checkValidity() === true`를 먼저 확인한다. 같은 form의 키보드 활성화로 확인 누락 **POST 400**을 받고 고정 한국어 사유를 표시한다. 모든 확인을 마친 뒤 다른 관리자가 먼저 승인하면 원래 native form은 **POST 409**와 최신 변경 안내를 받는다. 이후 native 공개 회수의 정상 저장도 확인했다. `force`, `noValidate`나 validation 우회를 쓰지 않는다.

초기 native 안내 부재는 RED로 보존했다. pointer click의 Playwright 안정성 대기에서 POST 없이 30초가 소진된 별도 실행은 원인이 미확정이며 pointer 성공 증거로 사용하지 않는다. 최종 native 검증은 위의 명시된 DOM·유효성 조건과 키보드 동작 범위다. 모든 생성 ID는 실패 시에도 `afterEach`에서 본인 최신 version을 읽어 철회하며 기존 fixture나 타인 자료는 정리하지 않는다. 원문 trace·쿠키·헤더·본문은 커밋하지 않았다.

## 화면 증거

합성 작성자·장소·직접 만든 화면 이미지만 포함한다. 최종 6건 실행에서 브라우저 screenshot으로 생성했으며 이미지 편집을 하지 않았다. 긴 누적 기록 대신 해당 입력 영역/카드를 캡처했다. 포커스 중 skip link나 고정 단계 표시가 보일 수 있다.

| 화면 | Desktop | Mobile |
| --- | --- | --- |
| 사진별 권리 선언 | [사진 입력](desktop-photo-declarations.png) | [사진 입력](mobile-photo-declarations.png) |
| 방문 근거·이해관계 | [방문 입력](desktop-visit-declarations.png) | [방문 입력](mobile-visit-declarations.png) |
| 본인 검수 대기·철회 | [제출 기록](desktop-owner-pending.png) | [제출 기록](mobile-owner-pending.png) |
| 관리자 승인 자료·회수 | [검수 카드](desktop-admin-approved.png) | [검수 카드](mobile-admin-approved.png) |
| 승인 자료와 장소 연결 | [공개 프로필](desktop-approved-profile.png) | [공개 프로필](mobile-approved-profile.png) |

로컬 합성 검증은 실증 사용자 검수나 라이브 Worker의 배포·RSI 확인을 대신하지 않는다. 사진 기능 공개와 운영 자료 재검수는 별도 운영 범위와 실행 증거가 필요하다.
