# CST 12/10 검수 증거 원장

상위 [실행계획 SSOT](../../plans/2026-11-13-cst-service-ssot.md), 하위 [검수 절차](../../operations/cst-acceptance.md)를 따른다. [execution-log.csv](./execution-log.csv)의 초기 8행은 **NOT_RUN** 표시이며 실제 실행 결과가 아니다.

- 실행마다 새 run_id로 행 추가; 과거 실패/skip·재시험 연결 보존.
- 실제 실행의 SHA·환경·시각·증거 없이는 PASS로 표시하지 않는다.
- 증거 파일에는 합성 데이터와 비식별 결과만 저장한다. 토큰/초대/학생·참여자 개인정보, 실제 상호·주소·사진 원문, 내부 승인 서명/개인자료는 공개 저장소에 넣지 않는다.
- 운영 데이터/실증 원자료는 권한 있는 별도 저장소에 두고 허용된 비식별 참조와 집계만 연결한다.
- 실제 실증·콘텐츠 검수·운영 배포/복구는 기술시험과 분리한다. 원장 템플릿 생성은 그 작업의 수행을 의미하지 않는다.
- `T02.CANCEL_SERVER`처럼 마침표 뒤 하위 case는 명시된 부분 검증만 PASS다. 최초 T01~08 전체 행은 해당 전체 시나리오를 완료하기 전까지 NOT_RUN을 유지한다. CI의 `source_sha`는 job 로그의 실제 checkout SHA이며 feature head·병합 SHA는 연결 PR에 남긴다.

## 2026-11-13 선행 조사

main `471a3eb`에서 PDF U01~U09/D01~D06/S01~S08/T01~T08의 코드/시험 존재를 대조했다. 이는 현재 기술 검수나 운영 실측이 아니다. 지도 query 손실, 추천 취소 UI, guest 임시저장/승계, 리뷰어 사전 승인/사진 gate·권리 메타데이터, 상세 정정 연결을 선행 결함/정책 항목으로 식별했다. 정확한 상태와 작업 링크는 SSOT·#354에서 관리한다.

## 2026-11-13 부분 시험 등록

- #369 기본 취소: PR head `063040b`, CI checkout `4fbf0bc`, integration 84파일450건 PASS. 연결 증거 [CI job](https://github.com/taejunyun1/Tasted_it/actions/runs/43425146034/job/131884631599), [desktop/mobile 검증](../cst-vote-withdraw-20261113/README.md), 병합 `a01e6e8`. 동시성/출처 보완은 #359 후속이다.
- #372 guest 저장/승계: PR head `8247237`, CI checkout `a366224`, integration 86파일467건 PASS. 연결 증거 [CI job](https://github.com/taejunyun1/Tasted_it/actions/runs/43428197684/job/131894767185), [로컬 사용자 흐름/실패 재시도](../cst-guest-save-20261113/README.md), 병합 `b469063`. 모바일 장소 전환 실패 P2의 최초 RED와 수정 GREEN을 보존했다. 외부 인증·운영 승계·전체 T03 합격은 주장하지 않는다.
- PR #374 최초 unit의 기존 RSI injected 시험 5초 timeout은 동일 head 실패 job 재실행에서 통과했으며 최초 실패는 PR 댓글/Actions에 보존한다. 원인은 UNKNOWN이다. 새 main 통합 head `25db0d6`의 최종4CI도 통과해 `3a1090c`로 병합했다.
- #373의 `/privacy` URL 이후 heading 누락은 #365 재발이며 원인 미확정이다. #376은 최종4CI/독립리뷰 뒤 `3ab7256`로 병합했다. 임시 빈 모듈 주입은 진단 JSON이 assertion 실패를 보존하는 시험일 뿐, 실제 CI 원인 재현·수정으로 세지 않는다.
