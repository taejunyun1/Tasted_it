# 2026-08-19 페르소나 랩 결과와 진입점

> **상태:** `PROPOSED` — 결과 메모와 다음 진입점이다. 하네스 `GO`, 라이브 실행, 일괄 공개, 공개 베타, `k6`, 새 의존성을 승인하지 않는다.

**추적:** [#210](https://github.com/taejunyun1/Tasted_it/issues/210) · [PR #211](https://github.com/taejunyun1/Tasted_it/pull/211)

**선행:** [#208](https://github.com/taejunyun1/Tasted_it/issues/208) · [PR #209](https://github.com/taejunyun1/Tasted_it/pull/209) 시나리오 카탈로그는 `main` `1ab3c50`. 이 문서는 그 카탈로그를 실행하지 않는다.

**거버넌스:** [`docs/decisions/2026-08-10-tech-stack-governance.md`](../../decisions/2026-08-10-tech-stack-governance.md) — Tasted_it에 Hugging Face, MatrAIx, Docker 에이전트, 새 binding을 넣지 않는다.

**담당:** Jay (`deximple`)

---

## 0. 한 줄

제품 게이트는 `#209` 시나리오 → 이후 격리 HTTP 하네스다. 페르소나 에이전트 랩은 저장소 밖 탐색용이다. 에이전트 실패는 사람이 재현하기 전에는 이슈가 아니다.

## 1. 고정된 결과

| 항목 | 결과 |
|---|---|
| 300 시나리오 | `#209` 병합. 상태 `PROPOSED`. 하네스 미착수. |
| 랩 위치 | 이 저장소 밖 `matraix-lab`. `runner/`는 MatrAIx-Persona-8B. |
| 스모크 | `matraix smoke` example survey → `Smoke: ok` (키 없음). |
| Cursor `crsr_` | `GET /v1/me` 200. chat-completions 없음. MatrAIx 백엔드 불가. |
| OpenAI `gpt-4o-mini` | 이 머신 키는 크레딧 소진. |
| NVIDIA NIM | OpenAI 호환. 카탈로그에 `gpt-4o-mini` 없음. |
| 기본 모델 | Muse Glimmer (`meta/muse-glimmer-30b`). 1명 example survey reward 1.0. |
| 1M 데이터셋 | 받지 않음. 내장 ~200 샘플만. |

키 값·토큰·이메일은 이 저장소에 쓰지 않는다.

## 2. 향후 진입점

다음 작업은 **새 브랜치**에서 하나만 고른다. `Archive/*`와 닫힌 `jay_synthetic_beta_300_scenarios`를 기준으로 쓰지 않는다.

| ID | 진입 | 하는 일 | 하지 않는 일 |
|---|---|---|---|
| E1 | `#209` 카탈로그 `GO` + 격리 하네스 | 시나리오 ID를 Vitest/`fetch`에 1:1. 메일·지오코딩 더블. | 라이브, 1M, `k6`, 300 브라우저 |
| E2 | 랩 `apps/retaste` 과제 초안 | preview/로컬 URL만. Muse Glimmer 5–20명. 가설 이슈. | 라이브 Worker, 운영 D1, 이 저장소에 러너 추가 |
| E3 | Persona 1M | 사람이 명시한 뒤에만, 랩에서 코호트 샘플. | 루트 All, 위키 실명 리포트 |

기본 다음 단계는 **E1 또는 E2**다. 둘을 한 PR에 섞지 않는다.

## 3. 이 문서가 승인하지 않는 것

라이브 `retaste-beta`에 에이전트, 운영 D1 쓰기, NAVER/Resend 실호출, Tasted_it CI에 랩 연결, 랩 실패를 required check로 승격.

---

# 2026-08-19 Persona lab results and entry points

> **Status:** `PROPOSED`. Results and pickup points only. Does not authorize harness `GO`, live runs, mass publish, public-beta, `k6`, or new dependencies.

**Product gate:** `#209` catalog, then an isolated HTTP harness. The persona-agent lab stays outside this repo. Agent failures are hypotheses until a human reproduces them.

**Default lab model:** Muse Glimmer (`meta/muse-glimmer-30b`). Next work picks **E1** (catalog `GO` + harness) or **E2** (lab `apps/retaste` on preview only), not both in one PR.
