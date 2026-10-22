# RSI 네이티브 검증용 기존 workerd 버전 고정

- 날짜: 2026-10-22
- 추적: [Issue #324](https://github.com/taejunyun1/Tasted_it/issues/324)
- 상태: **CONDITIONAL GO — 기존 개발 의존성 pin과 로컬 검증에 한정**. 최종 승인 원본은 필수 증거를 포함한 PR의 권한 있는 담당자 병합이다.
- 소유자: jay, RSI 개발 런타임 호환성 담당. 적용 범위는 `package.json`, `pnpm-lock.yaml`, 신규 회귀 테스트와 이 ADR이다.

## 문제와 재현

고정 RSI 평가기와 Workers 통합 테스트가 요청하는 compatibility date는 `2026-08-05`다. 기존 잠금 `workerd@1.20260730.1`의 모듈 최대 지원 날짜와 실제 선택 바이너리의 `--version`은 모두 `2026-07-30`이었다. 실제 native fetch의 잘못된 receiver 오류와 bind한 여섯 경로는 이 구형 엔진에서도 재현/통과한다. 따라서 dispatch 성공은 요청한 날짜를 지원한다는 증거가 아니다.

먼저 추가한 회귀를 구형 바이너리로 실행했을 때, 실제 최대 날짜 `2026-07-30 < 2026-08-05`로 실패했다. 외부 `MINIFLARE_WORKERD_PATH`가 있으면 설치된 바이너리 검증을 인정하지 않고 값이나 경로를 출력하지 않은 채 실패한다. 테스트는 Wrangler가 사용하는 Miniflare의 dependency resolution으로 workerd를 찾는다. 모듈 metadata 비교와 실제 바이너리 실행을 별개로 검사한다.

## 결정과 대안

기존 전이 개발 의존성 `workerd`만 root `package.json`의 `pnpm.overrides`로 정확히 `1.20261022.1`에 고정한다. pnpm은 `10.34.5`를 유지한다. 신규 직접 의존성, 테스트 프레임워크, runtime provider는 추가하지 않는다. Wrangler `4.118.0`, Miniflare `5.20260730.0-alpha`, Vite 등 기존 버전과 앱 소스/compatibility date/flags는 그대로다.

구형 엔진 유지 또는 target date를 낮추는 대안은 승인된 정확한 날짜를 검증하지 못한다. 과거 8월 엔진을 새 pin으로 채택하는 대신, 이후 격리된 코드 평가의 전제에 맞춰 확인 시점의 공식 안정 엔진을 선택한다. Wrangler/Miniflare 전체 갱신은 문제에 필요한 범위를 넘으므로 채택하지 않는다. 설치된 기술이라는 이유로 확장을 자동 승인하지 않으며 이번 Issue의 유지보수 예외만 적용한다.

[공식 workerd README](https://github.com/cloudflare/workerd/blob/main/README.md)는 버전 날짜가 최대 compatibility date이고, 최신 엔진에서 과거 날짜의 API 동작을 설정할 수 있음을 명시한다. 이에 따라 **바이너리 최대 날짜 `2026-10-22`와 Worker 요청 날짜 `2026-08-05`를 구분**한다. [공식 릴리스](https://github.com/cloudflare/workerd/releases/tag/v1.20261022.1)는 해당 안정 버전의 엔진 변경 이력을 제공한다. 이 계약은 Miniflare 내부 프로토콜 호환성까지 대신 보증하지 않으므로 실제 실행과 통합 테스트로 별도 확인한다.

[pnpm 공식 package.json 문서](https://github.com/pnpm/pnpm.io/blob/main/docs/package_json.md)의 pnpm 필드 제거는 v11부터다. 저장소의 v10.34.5에서는 root override와 잠금파일을 반영한 frozen install이 성공했다. v11 전환은 이 결정의 범위가 아니다.

## 공급망과 영향

공식 npm registry를 설치 전에 재조회하여 `latest=1.20261022.1`, 라이선스 `Apache-2.0`, Node 요구 `>=16`을 확인했다. 유지보수 주체는 Cloudflare다.

| 항목 | 원본 | 신규 |
|---|---|---|
| workerd | `1.20260730.1` | `1.20261022.1` |
| integrity | `sha512-zmfNIjwYSWFY5chGBOjWtH3xAE7p97FTC6vR4Ep98290ho6AeAR/NVcBD274YCLEUYzqm8yxdtZlxMybU8a3jA==` | `sha512-1R7ZbUatEePTPiwdqbzrVbns+hK2gb9oIwakPJT6ZLBUY6UJLgHnyHcj8DQCsWU9KDebcM7dUWy9e7aHjofQPw==` |
| 최대 지원 날짜 / 실제 바이너리 날짜 | `2026-07-30` / `2026-07-30` | `2026-10-22` / `2026-10-22` |
| Worker 요청 날짜 | `2026-08-05` | `2026-08-05` |

잠금 변화는 workerd, 그와 같은 버전의 5개 플랫폼별 optional binary 패키지, 해당 전이 참조와 override뿐이다. 관련 optional peer constraint도 override로 고정한다. 무관한 supports-color peer snapshot 재해석은 제거하고 기존 잠금을 보존했다. 직접 의존성 수는 증가하지 않는다. browser runtime에 패키지를 추가하지 않으며 앱 소스는 변경하지 않는다. 로컬 build는 통과했으나 사용자 성능/CPU/메모리 개선 또는 bundle byte 변화는 측정 결과로 주장하지 않는다.

추가 서비스, binding, cron, DB, 인증, credential, 수집·전송·저장 개인정보가 없다. 외부 응답은 로컬 합성 fixture로 대체하며 추가 유료 호출과 월 비용은 0이다. 운영 배포와 운영 D1/학생/메일/실제 모델 호출은 수행하지 않는다. Cloudflare 운영 엔진을 이 pin으로 변경하는 작업도 없다.

workerd 자체는 hardened sandbox가 아니라는 공식 경계를 유지한다. 이 PR은 고정 검토된 소스만 로컬 native Worker에서 실행하며, 후보/agent 코드를 Node에서 실행하지 않는다. R3 격리 실행의 안전성이나 승인·운영 성공을 이 pin으로 주장하지 않는다.

## 검증 결과와 남은 위험

- RED: 신규 날짜 회귀 1 실패/1 통과. native 성공과 날짜 미지원이 동시에 발생하는 기준선을 확보했다.
- GREEN: 날짜/native/R2 평가기 집중 32/32 통과. 실제 선택 바이너리 `workerd 2026-10-22`, 외부 override 없음. target `2026-08-05` 및 기존 flags에서 wrong receiver의 실제 `Illegal invocation`과 bind한 여섯 경로의 성공을 확인했다. structured runtime 날짜/fallback 경고도 거부하며, 경고 없는 downgrade는 별도 실제 바이너리 날짜 검사로 잡는다.
- 기존 R2의 거짓 PASS, allowlist/GET/인가 redirect, NO_CHANGE, 실행 오류·timeout·dispose 경로 회귀를 유지했다. 앱/기존 테스트 assertions를 약화하지 않았다.
- 전체 unit 159파일 1,137/1,137, 로컬 Workers integration 82파일 430/430 통과. typecheck/build 통과. frozen install 통과.
- 외부 override 음성 검증은 `RSI_EXTERNAL_WORKERD_OVERRIDE`로 suite 실패하며 override 값을 출력하지 않았다.
- `pnpm audit --prod`: 변경 전후 0. 전체 audit: 변경 전후 **35건(critical 1, high 9, moderate 21, low 4)**으로 미해결이다. 개발 도구 전이 의존성의 기존 경고를 이 PR에서 광범위 업그레이드하지 않는다. 감사 결과가 보안 무결점의 증거는 아니다.
- Workers integration에 기존 명시 `nodejs_compat`가 해당 날짜에서 기본값이라는 안내가 발생한다. 날짜/flag를 조용히 바꾸지 않았다. 로컬 검증은 라이브 Worker RSI, 배포, Linux/Windows 실행 증거가 아니다.

## Rollback과 제거 조건

문제가 생기면 별도 feature PR로 override와 관련 lock 변경을 되돌린다. 구형 엔진으로 되돌렸을 때 exact-date 검증은 **BLOCKED/RED**로 남기며 target date나 회귀를 낮추지 않는다. 운영 migration/data rollback은 없다.

upstream 기본 workerd 해석이 `2026-08-05` 이상을 지원하고 동일한 실제 바이너리·native receiver·여섯 경로·R2·통합 회귀가 통과하면 새 PR에서 override를 제거한다. 소유자는 upstream 기본 해석 변경 또는 native protocol 실패 때 재검토한다. R3는 병합된 main을 반영한 뒤 이전 image 증거를 폐기하고 새 image를 준비·측정해야 한다.
