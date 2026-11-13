# TEMP100 주소 정정과 revision2 운영 계획

- 추적: #421, #408. 소유: Jay/Codex. 상태: 이 PR 병합 시 아래 한정 운영을 승인한다.
- 발견: 첫 배치 준비 중 1행의 원문 주소가 해당 지자체의 공식 목록·상세·공식 길찾기 대상과 달랐다. 잘못된 주소에 다른 지점 좌표를 붙이지 않고 공개를 보류했다.
- 코드: `www.hwasun.go.kr` 한 호스트를 공개 source allowlist에 추가한다. 새 API/키/공급자/비용 계약/환경변수/DB migration은 없다.

## 고정 입력과 출처

기존 원본 데이터 SHA `d949f94c4a760aa42c2894ff220c0203d272da49a793cbe402dc79e38cedc900`를 보존한다. 단일 행의 주소·공식 출처·확인일을 정정하며 외부 공식 선정 참조는 유지한다. 공개 소개·사진·내부 점수는 바꾸지 않는다. 지자체 공식 상세의 상호·주소와 기존 원문의 전화 일치를 대조하고, 공식 길찾기가 가리키는 공개 지도 장소의 실제 point를 별도로 확인했다. 원문 HTML SHA와 정정 전후 값은 private `correction-lineage.json`에 보존한다.

| 구분 | 고정 값 |
| --- | --- |
| 이전 batch | `temp100-6a68e7b2d45c8763` (STAGED 유지) |
| 이전 manifest hash | `6a68e7b2d45c87631d43902bfe07fb31b2c0d8a18f5a2ef32d732f3087cd90a3` |
| 새 batch | `temp100-652f4d261db7795b` |
| 새 manifest hash | `652f4d261db7795b1148bfa395581a5d0ba40d28f1fd6a892f582e8baf0d494f` |
| 새 행/사진 | 100행 / 23개. 사진 바이트 SHA는 이전 검증 결과와 동일 |

## 승인된 후속 실행

대상은 기존 beta Worker·기존 D1·기존 R2이며 담당자는 Jay/Codex 운영 담당자다. 본 PR의 merged main을 배포한 후 다음 범위만 수행한다.

1. 기존 100행 STAGED batch와 원본 파일은 수정·삭제하지 않는다. 새 private manifest의 hash를 위 표와 대조하고 ADMIN 전용 stage에 100행을 제출한다.
2. 원문과 실제 point를 대조한 100행 좌표 증거를 새 batch에 적용한다. 좌표 0, 기본 지도 중심, 주소 불일치, 가짜 인허가/평가/방문은 허용하지 않는다. 100/100 확인 전에는 공개하지 않는다. 추가 production NAVER 조회는 없다.
3. 같은 사진 23개를 새 batch prefix의 정확한 key에 재업로드하고 실제 내려받은 바이트 SHA·content type을 확인한다. 이 실행과 이전 실행의 명시적 R2 관리 합계는 put 46개/get 46개 이하다. 사진의 EXIF/JFIF 검사 및 합성/실사진 구분은 기존 검증을 이어받는다.
4. 기존 승인 흐름을 포함한 수동 운영 HTTP 변경 요청은 누계 300회 이내다. 필요한 경우 기존 승인된 ADMIN을 위한 30분 운영 세션을 최대 2개 사용하고 종료 후 철회한다. 최근 인증을 위조하거나 인증 보호를 낮추지 않는다.
5. `temp100-publication-sql.mjs`로 새 hash와 현재 canonical version·100개 현재값을 결속한다. 고정된 일회성 audit trigger로 공개·감사를 원자 실행하며 성공/실패 모두 정확한 trigger를 DROP하고 잔존 0을 확인한다.
6. 새 batch 100개 공개, 기존 장소 불변, 사진 있음/없음, 목록·검색·상세, 관리자 비로그인 거절, live RSI를 확인한다. 새 batch의 공개·실바이트 검증 후에만 이전 batch prefix의 승인된 정확한 23개 R2 key를 삭제한다. 이전 STAGED batch/감사/로컬 원본은 정정 이력으로 남긴다.

## 실패와 rollback

좌표·사진·권한·버전·hash 확인 실패 시 공개를 중단한다. 공개 전에는 이전 런타임 복귀가 가능하다. **새 source host를 담은 batch 공개 후에는 해당 host를 이해하지 못하는 이전 런타임으로 rollback하지 않는다.** 공개 후 장애 시 새 schema/parser를 포함한 병합 소스로 maintenance fence를 배포하거나 forward fix한다. 필요 시 새 batch만 회수하며 기존 canonical·회원 평가·저장은 보존한다.

최종 완료는 운영 상태와 live 검증을 root SSOT에 반영했을 때다. 이 PR의 테스트/병합만으로 배포·공개 완료를 주장하지 않는다.
