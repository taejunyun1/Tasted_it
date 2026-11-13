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

## 리뷰 후 추가 보완

- native 검수 400 뒤 사유가 빈 값이 되는 P2를 기존 사유 보존 기대값으로 RED 재현했다. 서버가 길이를 검증한 동일 리뷰·동일 version의 validation400에만 최대 500자 사유를 React 기본 escaping으로 복원한다. 권한 실패·409·다른 카드·변경 version과 checkbox는 승계하지 않는다. 보완 후 desktop/mobile native 2건 PASS(23.0초), 해당 컴포넌트 단위 5건 PASS(HTML escape·500/501자·다른 카드/version 포함). 기존 pointer 및 #365 원인 미확정 경계는 그대로다.
- CI의 `synthetic-beta-200.test.ts`는 일반 회원의 본인 자료 조회 허용 전 계약인 GET403을 기대했다. 일반 회원 6명의 GET200에서도 본인 history·장소/카테고리·위조 notice가 비어 있고 실제 존재하는 타인의 PENDING 방문·사진 권리 메타데이터가 반환되지 않음을 확인한다. 정상 입력의 신규 제출403/활동 리뷰어 필수, 타인 철회403/소유자 필수, 전후 리뷰·사진·전이·cleanup·투표·제안 개수와 타인 자료 불변을 검증한다. 강등 소유자 본인 철회 허용과 기존 부정·abuse·viewer 시험은 유지했다. 해당 합성 integration 단독 1건 PASS(10.64초); 이전 CI의 534 PASS를 새 실행 수로 합산하지 않는다.

## 실행 checkpoint와 시각 출처

[verification.json](verification.json)에 실행 당시 checkout의 전체 SHA·dirty 여부·후속 동일 소스 보존 SHA·UTC/KST 시각을 각각 기록했다. 다음 과거 실행의 환경은 모두 `LOCAL_DIRTY_SYNTHETIC`이다. 후속 보존 commit이 당시 checkout이었다거나 최종 push head를 한 번에 전체 검증한 것으로 해석하지 않는다.

| 실행 | 실제 checkout SHA (dirty=true) | 후속 소스 보존 SHA | 종료 결과 로그 시각 UTC / KST |
| --- | --- | --- | --- |
| 당시 검수 6 PASS | `7a252a41e392dedc17e46247a1d0eadda9aaf292` | UI/E2E: `ad9a12321572590d773b2e0e787b72f0a64508cb` | 2026-11-13 13:52:35.644984 / 22:52:35.644984 |
| 사유 보존 RED 1 | `ad9a12321572590d773b2e0e787b72f0a64508cb` | runtime은 해당 SHA, 보존 기대값을 추가한 시험 변경은 미커밋 상태 | 2026-11-13 14:03:46.817061 / 23:03:46.817061 |
| 사유 보완 native 2 PASS | `ad9a12321572590d773b2e0e787b72f0a64508cb` | UI/E2E: `23991c7f6e0125d7eb7b88a24afca281e7c49931` | 2026-11-13 14:05:47.173432 / 23:05:47.173432 |
| 합성 계약 integration 1 PASS | `ad9a12321572590d773b2e0e787b72f0a64508cb` | 시험: `23991c7f6e0125d7eb7b88a24afca281e7c49931` | 2026-11-13 14:08:04.947119 / 23:08:04.947119 |

위 시각은 결과 로그의 마지막 mtime이며 프로세스 exit 별도 계측값이 아니다. 첫 RED는 비공개 ignored trace와 로컬 결과 로그로 보존했으며 `verification.json`에는 비민감 실패 조건만 남겼다. 보완 후 두 UI 단위 파일은 합계 11 PASS였다.

최신 main #389 `f0ca8e0`까지 보존 통합한 clean checkpoint `a61050f69d2d1a2d3899260ad97789171cd743f0`에서는 typecheck/build를 별도로 완료했다. 이 두 명령은 프로세스 완료 시각을 계측했으며 build 종료는 UTC 2026-11-13 14:11:31.027653 / KST 23:11:31.027653이다. JSON의 `compileRuns`에 시작/종료·exitCode·clean 여부를 기록했다. 이 뒤 증거 문서 추가는 제품 소스 변경이 아니다.
