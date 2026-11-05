# 카테고리 미분류 잔여 처리 경로 — 규칙 확장 vs 분류기 vs LLM (보류)

- **상태:** DEFERRED — 학생 수동 검토 결과 관측 후 재논의
- **작성일:** 2026-11-05
- **추적:** [Issue #352](https://github.com/taejunyun1/Tasted_it/issues/352) · [PR #348](https://github.com/taejunyun1/Tasted_it/pull/348) · [PR #349](https://github.com/taejunyun1/Tasted_it/pull/349) · [PR #350](https://github.com/taejunyun1/Tasted_it/pull/350)
- **적용 범위:** `CATEGORY_CONFIRMATION` 단계의 자동 카테고리 배정 정책

## 1. 배경

2026-11-05 `apply-category-fallback` intent(결정론적 3단계 매핑 + '기타' 최후 수단)를 도입해 `mapped_category_id` 없는 VERIFIED 항목의 영구 잔류를 해소했다.

라이브 실측 결과:

- 폴백 감사 860건: subtype 466 · path 54 · name 61 · 기타 279(이 중 무근거 122건 원복)
- 무근거(license·검증·상호명 전무) 200건은 자동 배정 불가 → `ON_HOLD(NO_EVIDENCE)` 이동
- FINAL_APPROVAL 414 → 1,585 (사람 공개 대기)

## 2. 평가한 경로

| 경로 | 내용 | 판단 |
|---|---|---|
| A. 규칙 확장 | 현재 맵/키워드 테이블 확장 | 이미 배포됨, 커버리지 포화에 가까움 |
| B. 분류기(자체 jev/판단기) | 신호를 모아 결정하는 별도 검증 함수 | 규칙과 동일 입력이라 한계 유사 |
| C. LLM 판단 — Workers AI | `verifyAiCategoryV2`(llama-3.1-8b, 이미 바인딩) 확장 — 후보 slug 목록 내 선택만 허용하는 verifier 패턴 | 최소 거버넌스 비용, 그러나 이득 제한적 |
| D. LLM 판단 — OpenAI decision | `OPENAI_API_KEY` secret + structured output | 신규 외부 서비스·시크릿·이그레스 → 거버넌스 예외 등록 필요 |

## 3. 판단 근거 (왜 보류인가)

- **AI도 무근거는 못 푼다.** 남은 잔여의 상당수는 license·검증·상호명이 전무한 항목이라 어떤 판단기로도 신호가 없다.
- **결정론 규칙이 이미 정밀 커버리지의 대부분을 처리했다.** AI 추가 이득은 ~150-400건의 정밀도 개선 정도로 추정.
- **측정 후 결정 원칙.** 학생 수동 검토(#352)가 실제로 어느 정도 정확도·속도로 진행되는지가 최적 경로를 결정한다 — 결과를 보기 전에 새 서비스·시크릿을 도입하는 것은 추측 투자다.

## 4. 재논의 조건

학생 공개 검토(#352) 완료 또는 유의미한 진척 후 다음을 보고 재판단한다:

- 사람 검토의 실측 처리량·품질(보류 비율, 오공개 사례)
- 남은 미분류 규모와 구성(무근거 vs 근거 있는 애매)
- 경로 C/D 도입 시 verifier 패턴 유지(후보 slug 강제 + 감사 + 자동 공개 불가)와 tech-stack 거버넌스 기록 의무

## 5. 불변 조건

어떤 경로를 선택하더라도:

- FINAL_APPROVAL 공개는 사람만 수행한다.
- 자동 배정은 `categoryOverrideReason`/`basis` + 감사 로그로 사람 결정과 구분된다.
- 무근거 항목은 자동 배정 대상이 아니며 사람 판단 큐에 남긴다.
