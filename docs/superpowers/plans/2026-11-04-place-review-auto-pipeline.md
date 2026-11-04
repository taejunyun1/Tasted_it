# 검수 자동 파이프라인 설계 — 사람과 동일한 게이트의 자동 진행

상태: PROPOSED (2026-11-04)
소유: Jay · 선행: [#335 병목 진단](./2026-11-04-place-review-unblock.md), sweep 구현 [#336](https://github.com/taejunyun1/Tasted_it/pull/336)

## 원칙

자동화 대상은 "사람이 결정론적 검사를 스탬프하는 구간"이다. 판단이 필요한 구간과 공개는 사람에게 남기되, 남는 사람 큐가 실제로 작아지도록 자동 통과를 먼저 돌린다.

## 단계별 자동화 분할

| 단계 | 자동 | 조건 |
| --- | --- | --- |
| SOURCE_REVIEW | ✅ | `sourceReady` (영업·주소·좌표) — 완전 결정론 |
| NAVER_VERIFICATION | ✅·비용 | 실제 NAVER API 호출. 지역 10,000·총 20,000/일 기존 예산 가드 재사용. VERIFIED/MATCHED만 통과, FAILED·확인필요는 사람 큐에 잔류 |
| CATEGORY_CONFIRMATION | ✅ | 네이버 매핑·선택 카테고리가 활성 leaf일 때만. 모호분 skip |
| DUPLICATE_REVIEW | ✅ | 열린 중복 후보 0건일 때만. 후보 존재 시 사람 |
| FINAL_APPROVAL → 공개 | ❌ 기본 | "공개는 사람" 정책 유지가 기본(아래 정책 변경 옵션) |

## 트리거

- **주: 수집 완료 훅** — `public_data_sync_runs`가 정상 종료할 때 해당 run에서 들어온 신규 후보에 한해 자동 진행. 신규 cron·Queue 없이 이벤트 기반으로 돈다
- **보조: 관리자 sweep**(이미 구현) — 백로그 소화용 반복 수동 트리거
- 신규 scheduled job은 추가하지 않는다(거버넌스상 별도 검토 필요)

## 실행 한도·안전

- 단계별·실행별 유한 상한(예: sync 훅 1회당 단계 최대 500건, 서브요청 예산 내). 백로그 소화는 관리자 sweep 반복으로
- 모든 진행·스킵은 기존 `adminAuditLogs` + skip code로 기록 — "자동이 잘못 올린 것"을 사유로 추적 가능
- feature flag(`REVIEW_AUTO_PIPELINE_ENABLED`)로 전체 on/off — 꺼지면 수동 운영으로 즉시 복귀
- NAVER 예산 초과 시 해당 지역만 중단, 다른 지역 계속(기존 팩 정책)

## 정책 변경 감안 — 공개 자동화 옵션

### 옵션 A (권고·기본): FINAL_APPROVAL까지만 자동
공개 버튼은 사람. 자동 도달 품질을 1~2주 관측한 뒤 자동 공개를 다시 판단한다.

### 옵션 B (조건부 자동 공개 — 정책 변경 필요)
다음 **전부** 충족 시에만 자동 공개를 허용하는 정책 개정:
- `sourceReady` + naver `VERIFIED` 또는 `MATCHED`(MANUAL_OVERRIDE 제외)
- 활성 leaf 카테고리 확정 + 열린 중복 후보 0 + 활성 제외 0
- local-dining 판정이 REVIEW/EXCLUDE가 아닌 통과
- 자동 공개도 `adminAuditLogs`에 actor=`AUTO_PIPELINE`으로 기록되고, 일일 자동 공개 상한(예: 100건) 존재
그 외 항목은 사람 FINAL_APPROVAL 큐로. 사람은 잔류분만 본다.

### 옵션 C (전면 자동): 비권고
확인필요·중복 존재분까지 기계 판정하면 오공개 위험이 크다.

**권고 순서**: A로 1단계 배포 → 자동 도달분의 오진행률·스킵 사유 분포 관측 → B를 별도 정책 개정으로 판단. 측정 없이 B로 건너뛰지 않는다.

## 작업 분할 (각각 별도 PR)

- AP-1: sync 완료 훅 + 단계 sweep 재사용 배치 러너 + flag (코드)
- AP-2: NAVER 자동 검증 배치(기존 adapter·지역 예산 재사용, 건당 API 1회)
- AP-3: 자동 진행 관측 지표 — 단계 유입/통과/스킵 사유 집계를 운영 화면 또는 run 테이블에 기록
- AP-4: 정책 변경 문서 — 옵션 B 채택 시 `공개는 사람` 조항을 "결정론 전항 충족 시 자동, 잔여는 사람"으로 개정하는 별도 문서/PR
- 의존: 11-03 RUNNING 좀비 run 회수 + sync 24h timeout 재설계(P0-4)가 선행되면 훅이 안정화

## 비범위
- 게이트 조건(`evaluateReviewAdvance`) 자체 완화 — 자동은 기존 기준 그대로
- 중복 병합/연결의 기계 판정, 확인필요 항목의 자동 통과
- 학생 시스템 변경, 신규 외부 서비스·cron·Queue 바인딩

## 위험과 완화
- 자동 오진행 → 단계 상한·플래그 off·감사 사유로 회수; rollback=flag off(코드 revert 불요)
- 네이버 실비용 → 기존 일일 지역 예산이 상한
- 사람 큐가 예상보다 안 줄면(모호분 과다) → AP-3 지표로 단계별 병목을 다시 판단
