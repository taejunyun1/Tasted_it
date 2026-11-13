# W08 핵심 desktop CI 회귀 범위

- 추적 #388 / CST SSOT W08. UI #390 병합 `a95f9ee`에서 본인 완료 worktree를 재사용해 시작했고, header #392 병합 `646392cdc289926078f3d2df5a11e894849ea5cd`를 반영했다.
- 변경 범위는 기존 workflow의 smoke 명령, 기존 CI 계약검사, 이 근거 문서다. runtime·E2E 구현·schema·의존성·공급자·비밀값·메일/원격/유료 호출·RSI 실제 Docker 실행을 추가하지 않는다. 로컬 E2E 서버/5173는 실행하지 않는다.
- 기존 release/places/student workspace/request session/invite handoff 5파일과 필수 job4개·읽기 권한·worker1/retry0·smoke job20분·pinned actions·기존 익명 legal 실패 metadata 업로드는 보존한다.

| 추가할 제한 파일 | Chromium 실행 대상 | 경계 |
| --- | ---: | --- |
| vote-withdraw | 1 | 반응 변경·취소·reload, 저장 유지 |
| guest-save-merge | 2 | 저장 실패 재시도·로그인 승계·실제 batch 실패 후 명시 재연결 |
| reviewer-moderation | 3 | 승인·수정·회수·사진 gate, native POST, client entry 보류 |
| auth-entry-hydration | 1 | 인증 href의 SSR/client 일치와 검색조건 보존 |
| header-layout | 1 | 좁은 화면·CSS 확대, 터치 대상·hit·Tab |

기존16+추가8=24개 실행과 guest 파일의 모바일 전용2개 SKIP는 사전 예상이다. `--list` 수집과 실제 CI 결과를 구분하며, 이 표 자체는 PASS 증거가 아니다. 전체 E2E 폴더·모바일 전체·사진/평가/관리 시험 전체를 추가하지 않는다.

계약검사는 `e2e-smoke` job 안의 지정한 단일행 직접 실행 형식에서 승인된 정확한10파일·Chromium 인자를 확인한다. 이 형식의 파일 누락/확대·추가 grep/project 인자·명령 이동을 거절하고 기존4job 이름·read 권한·20분·직렬 설정도 확인한다. 임의 shell/YAML 실행을 완전히 분석하는 검사는 아니므로 workflow diff와 실제 CI도 함께 검토한다. UI 합성 자료의 BASE_URL 방지·새 context NAVER 차단·생성 ID별 최신 version 철회는 #390 소스/증거에서 확인했다. 실제 외부 연동·운영 동작이나 참여자 실증을 검증한 것은 아니다.

RED: header 병합 main에서 보강한 계약검사는 기존 workflow의 누락된5파일 때문에 1 FAIL/3 PASS였다. syntax/setup 오류가 아닌 승인 목록 미연결이 실패 원인이었으며 checkpoint `6b8a986e873961323240fe3b4dae0b44561705e6`에 보존했다.

GREEN: workflow의 기존 smoke 명령 한 줄에5파일만 추가했다. CI 계약4건+기존 E2E D1 격리2건이 6/6 PASS(108ms)다. 같은10파일·Chromium 명령의 `--list`는 실제 **26 tests in 10 files**를 수집했다. 이 명령은 browser/server를 실행하지 않았으며 실제24 PASS/2 SKIP를 입증하지 않는다. 실행 결과·정확 head·CI 소요시간은 PR의 필수4CI 결과로 기록한다.

production audit0, 개발 포함 기존46건(critical1/high15/moderate26/low4)과 lockfile 변경0을 확인했다. 기존 CI run43434976123의 smoke step4분/job4분53초는 과거 기준선일 뿐 확대 후 예산 통과를 보장하지 않는다. 20분 증액이나 timeout/retry로 실패를 숨기지 않는다.

독립 읽기 전용 검토에서 기존 명령 한 줄의 제한 확대·계약검사의 job 범위·문서의 수집/실행 구분을 확인했고 미해결 P1/P2는 없다.
