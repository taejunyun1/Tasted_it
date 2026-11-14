# B06 작업 이력 조회 검증

#424, 기준 `origin/main@d04fe70`. 모든 로컬 검증은 합성 D1과 기존 QA 세션으로 수행했으며 운영 DB·계정·작업을 변경하지 않았다.

- 집중 unit 4개: cursor 형식·중복 인자·목록/작업 종류 결속과 기존 registry.
- 집중 D1 integration 5개: 익명/USER/만료 세션 거부, 잘못된 cursor와 POST 거부, 50건 상한, 같은 순간의 SQLite/ISO/+09 형식과 `.123789` 52행 무누락 페이지, 뒤늦은 삽입 제외, 같은 cursor 재현, 감사/operation/영수증/job 정확 연결, 접수와 완료 구분, 원문 비노출, 미확정/만료/깨진 영수증 처리, 읽기 전후 DB 무변이, 쿼리 계획.
- desktop/mobile E2E 2개: 운영 홈에서 이력 화면 이동, 로컬 재계산 미리보기만 만든 뒤 실행 없이 영수증 조회, 필터·기존 정합성 감사 이동, 가로 넘침 없음과 비공개 응답.
- `pnpm run typecheck`, `git diff --check`: 통과.
- `pnpm audit --prod`: 알려진 취약점0. 전체 audit의 기존 개발도구46건(critical1/high15/moderate26/low4)은 별도 범위이며 의존성·lockfile 변경 없음.

[쿼리 계획](query-plan.json)은 인덱스가 없을 때 정렬용 임시 B-tree와 감사 전체 스캔을 확인한 뒤, 0045 적용 후 인덱스 검색으로 바뀐 증거다. 0045는 기존 시각 문자열을 수정하지 않고 `julianday(created_at)` 식 인덱스2개와 정확 연결 인덱스1개만 추가한다. 실제 운영 성능 수치로 확대하지 않는다.

초기 점검에서 확인한 사항도 보존한다. 세부 fixture가 앞선 52개 행 뒤로 밀려 필터가 필요했던 assertion을 수정했다. 독립 리뷰에서 SQLite 분수초 반올림과 JS Date 절삭 차이가 발견되어, cursor는 표시용 시각 대신 DB의 numeric Julian 정렬 키를 그대로 보존하도록 수정했고 `.123789`/시간대 혼합52행으로 검증했다. 첫 E2E에서 초기 hydration 중 링크 이동과 캐시 지시자 순서 차이가 드러나, 라우터 준비 확인과 순서에 무관한 private/no-store 검사로 보완했다. timeout·retry·기존 테스트는 변경하지 않았다.

[데스크톱](desktop.png) · [모바일](mobile.png): 최종 로컬 실행 화면. 텍스트·영수증·목록의 잘림/겹침과 가로 넘침이 없음을 직접 확인했다. 화면의 작업 ID와 참조는 합성 자료다.

운영 적용과 live 검증은 [별도 실행 계획](../../operations/2026-11-14-b06-activity-rollout.md)을 따른다. 이 자료는 운영 배포나 실제 위험 작업 성공을 주장하지 않는다.
