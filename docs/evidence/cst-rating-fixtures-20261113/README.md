# W06/T06 평가 고정 기대값 검증

- 추적: #384 / #360. 기준 main `3bc7758f43adf7cb4cb92aa6d45bbd08d99b76e5`(#382 병합), DEC-03의 기존 `rating-v2.0` 구현 기준.
- 변경은 기존 시험 fixture와 assert, 이 근거 문서에 한정한다. 서버·산식·schema·역할/승인 정책·의존성을 변경하지 않는다. 실제 외부 서비스·운영 D1·유료 API·브라우저/5173·새 전체 local suite 실행은 없다.

## 기존 검증 공백과 이번 보완

기존 시험이 GREEN이어도 명시되지 않은 경계가 검증됐다고 볼 수 없다. 원본은 7/8표, 30% 상한, 신뢰도 eligible4/6, 군집 overlap9/10·일치0.7/0.9, 재계산 반복을 검증했다. 다만 9표·일반표0 예외·eligible5·정확히0.8인 간접 연결, DB에 저장한 신뢰/감쇠가 최종 점수에 전달되는 수치를 직접 assert하지 않았다. 원본의 3명 군집은 모두 연결된 fixture여서 AB/BC만 연결되는 경우를 구분하지 못했다.

이 작업은 이미 구현된 동작의 회귀 검증 범위를 보완한다. 원본의 제품 동작 결함을 발견하거나 production 코드를 고친 작업이 아니므로 새 assertion의 최초 GREEN을 새 동작의 RED→GREEN으로 표현하지 않는다. 의도적으로 잘못된 기대값·설정 오류를 만들어 RED를 꾸미지 않았다. 기존 고정 기대값 67·35·75와 표본/중복 제거 검증은 보존했다.

## 정책에서 독립 산출한 기대값

기대값은 시험 대상 계산 함수를 호출해 생성하지 않는다. 아래 수치와 독립 검산을 먼저 정하고 기존 fixture에 literal 기대값을 넣었다. 점수 반올림은 최종 단계에만 적용한다.

| 경계·fixture | 독립 계산·기대값 | 시험 |
| --- | --- | --- |
| 일반 7/8/9표, 양성5/6/7·음성2 | 7표는 비공개/null. 8표는 `(2+6)/(4+8)×100=66.666…`→67. 9표는 `(2+7)/(4+9)×100=69.230769…`→69 | `tests/unit/rating-v2.test.ts` |
| 일반0·리뷰어8 전원 양성, 중립 가중치 | 일반표가 없으면 30% 상한 예외. raw/combined8, share1, `(2+8)/(4+8)×100=83.333…`→83 | 같은 v2 unit |
| 일반8 전원 음성·리뷰어20 양성×1.4 | 기존 기대값 보존: raw28, 상한 질량 `8×0.3/0.7=24/7`, share0.3, `(2+24/7)/(4+8+24/7)×100=35.185…`→35 | 같은 v2 unit의 기존 상한 fixture |
| 신뢰도 eligible5/correct5 | posterior `(2+5)/(4+5)=7/9=0.777777…`, weight `0.6+0.8×7/9=1.222222…`; 5건부터 ACTIVE. 기존4건 중립·6건 활성 검증 보존 | 같은 v2 unit |
| 10곳에서 A 전부+, B 마지막2곳−, C 마지막4곳− | AB=8/10, BC=8/10, AC=6/10. 정확0.8인 AB/BC만 간선, 군집ABC의 감쇠 `1/√3=0.5773502691896258` | `tests/unit/reviewer-similarity.test.ts` |
| 10곳×일반8 전원 양성·승인 리뷰어A 10/10 적중 | posterior12/14, weight `0.6+0.8×12/14=9/7=1.2857142857142858` | `tests/integration/reviewer-trust.server.test.ts` |
| 같은 fixture의 리뷰어B 9/10 적중 | posterior11/14, weight `0.6+0.8×11/14=43/35=1.2285714285714286` | 같은 trust integration |
| 두 리뷰어 overlap10·agreement0.9 | 저장 간선 damping `1/√2=0.7071067811865475`, 두 가중치 감쇠합 `(9/7+43/35)/√2=1.7778684784118908` | 같은 trust integration의 저장 snapshot/edge 및 실제 재계산 |
| 첫9곳: 일반8·리뷰어2 모두 양성 | 합계 질량 `8+1.7778684784`. Beta posterior는 `85.4839665…`→85, 일반 점수83, 리뷰어2명 그룹은 비공개/null | 같은 trust integration, 대표 place0 |
| 마지막곳: 일반8과 A 양성·B 음성 | 양성 질량 `8+(9/7)/√2`, 음성 질량 `(43/35)/√2`. Beta posterior는 `79.1787010…`→79 | 같은 trust integration, place9 |
| 일반6·승인 리뷰어2의 기존 재계산 fixture | 기존 점수75·총8/일반6/리뷰어2 보존. neutral raw/combined2, share0.25. 두 번째 계산도75, 같은 id/hash, snapshot1 | `tests/integration/rating-recompute.server.test.ts` |
| 일반0·승인 리뷰어101 전원 양성 | raw/combined101, share1, `(2+101)/(4+101)×100=98.095238…`→98 | `tests/integration/reviewer-public-consumers.test.ts`의 기존101명 D1 chunk fixture |
| 외부 평점·평가수 배제 | NAVER mock의 `rating:5`, `ratingCount:1000000`에도 출력은 기존 이름·분류·주소·좌표만 정확히 일치. 실제 외부평점을 조회·저장한 시험이 아님 | `tests/unit/naver-local-search.test.ts` |

85/79 fixture는 동일 moderation epoch의 신뢰도·감쇠가 적용된 조건이다. 리뷰어 질량1.777868…은 일반8의 상한24/7보다 작으므로 이 fixture는 30% 상한을 발동시키지 않는다. 상한 발동 자체는 기존 점수35 unit에서 별도로 검증한다. 두 번의 재계산 사이에는 투표·승인 상태·epoch/revision을 변경하지 않는다.

새 승인 fixture는 합성 provenance를 명시한다. 실제 관리자 검수·방문·권리 확인이나 참여자 실증을 했다는 뜻이 아니다. #382의 GENERAL/REVIEWER/LEGACY 분리·비적격 제외·epoch 무효화 시험을 같은 집중 실행에 포함했다. NAVER match score는 이름/주소 일치도이며 맛 평점으로 취급하지 않는다.

## 실행 증거

2026-11-13 KST, 기존 pnpm/Vitest/Workers pool과 로컬 합성 D1/mock fetch만 사용했다. 두 명령 모두 `--maxWorkers=2`다.

```sh
pnpm exec vitest run tests/unit/rating-v1.test.ts tests/unit/rating-v2.test.ts tests/unit/reviewer-similarity.test.ts tests/unit/naver-local-search.test.ts --maxWorkers=2

pnpm exec vitest run --config vitest.workers.config.ts tests/integration/rating-recompute.server.test.ts tests/integration/reviewer-trust.server.test.ts tests/integration/reviewer-public-consumers.test.ts --maxWorkers=2
```

| 단계 | 결과 |
| --- | --- |
| 수정 전 기준 main | unit4파일19/19 PASS(242ms), Workers integration3파일18/18 PASS(1.95s) |
| fixture 보완 후 | unit4파일21/21 PASS(271ms), Workers integration3파일18/18 PASS(3.25s) |

typecheck 통과, production dependency audit0을 확인했다. 개발 의존성을 포함한 전체 audit은 기존46건(critical1/high15/moderate26/low4)이며 의존성·lockfile 변경은 없다. 독립 읽기 전용 검토에서 고정 수치·기존 assertion 보존·문서 경계를 확인했고 미해결 P1/P2는 없다.

전체 회귀는 필수 CI 네 가지에서 확인한다. 이번 로컬 수치는 운영 응답시간/처리량이나 실제 지원 브라우저·기기·참여자 실증 성과를 뜻하지 않는다. 상위 SSOT의 해당 실제 사실은 별도 상태로 유지한다.
