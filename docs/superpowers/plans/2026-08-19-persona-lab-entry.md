# 2026-08-19 페르소나 랩 결과와 진입점

> **상태:** `PROPOSED` — 결과 메모와 다음 진입점이다. 하네스 `GO`, 라이브 실행, 일괄 공개, 공개 베타, `k6`, 새 의존성을 승인하지 않는다.

**추적:** [#210](https://github.com/taejunyun1/Tasted_it/issues/210) · [PR #211](https://github.com/taejunyun1/Tasted_it/pull/211) · n200 가설 [#212](https://github.com/taejunyun1/Tasted_it/issues/212) · [PR #213](https://github.com/taejunyun1/Tasted_it/pull/213) · [`2026-08-19-persona-lab-n200.md`](./2026-08-19-persona-lab-n200.md)

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
| 설문 분포 모델 | 게스트 첫인상 MCQ는 Nemotron 3.5 Lightning. Glimmer는 n12 방향만. Luna n200은 문항 붕괴라 쓰지 않음. |
| 1M 데이터셋 | 코호트 n=200 샘플 완료 (사용자 요청). 루트 All 아님. 집계는 [`persona-lab-n200`](./2026-08-19-persona-lab-n200.md). |

키 값·토큰·이메일은 이 저장소에 쓰지 않는다.

## 2. 향후 진입점

다음 작업은 **새 브랜치**에서 하나만 고른다. `Archive/*`와 닫힌 `jay_synthetic_beta_300_scenarios`를 기준으로 쓰지 않는다.

| ID | 진입 | 하는 일 | 하지 않는 일 |
|---|---|---|---|
| 사람 재현 | localhost 게스트 경로 | 랩 가설 중 재현된 것만 이슈. | 랩 숫자를 GO/CI로 승격 |
| E1 | `#209` 카탈로그 `GO` + 격리 하네스 | 시나리오 ID를 Vitest/`fetch`에 1:1. 메일·지오코딩 더블. | 라이브, 추가 1M, `k6`, 300 브라우저, n200 메모와 한 PR |
| E2 | 랩 `apps/retaste` 설문 | **n200 Lightning 완료.** 기록은 n200 문서. | 라이브 Worker, 운영 D1, 이 저장소에 러너 추가 |
| E3 | Persona 1M | n=200은 했음. 추가 샘플은 사람 명시 후에만. | 루트 All, 위키 실명 리포트 |

기본 다음 단계는 **사람 재현 또는 E1**이다. E1과 랩 메모를 한 PR에 섞지 않는다.

## 3. 이 문서가 승인하지 않는 것

라이브 `retaste-beta`에 에이전트, 운영 D1 쓰기, NAVER/Resend 실호출, Tasted_it CI에 랩 연결, 랩 실패를 required check로 승격.

---

# 2026-08-19 Persona lab results and entry points

> **Status:** `PROPOSED`. Results and pickup points only. Does not authorize harness `GO`, live runs, mass publish, public-beta, `k6`, or new dependencies.

**Product gate:** `#209` catalog, then an isolated HTTP harness. The persona-agent lab stays outside this repo. Agent failures are hypotheses until a human reproduces them.

**Survey distribution model:** Nemotron 3.5 Lightning for this guest first-look MCQ. Glimmer n12 is direction only. Luna n200 collapsed; do not use it as a distribution. 1M cohort n=200 already ran; details in [`persona-lab-n200`](./2026-08-19-persona-lab-n200.md). Next work is **human localhost repro or E1**, not both in one PR with the lab memo.
