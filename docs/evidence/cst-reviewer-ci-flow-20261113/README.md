# 리뷰어 검수 회귀 시험의 독립 과업 분리

#395 후속이며 #393의 확장 CI 실패를 분석했다. 제품 source·workflow·header·운영 설정은 변경하지 않는다. 모든 실행은 격리한 로컬 합성 자료이며 운영 배포·원격 DB·실제 학생 자료·메일·유료 요청·새 의존성0이다.

## 서로 구분하는 관측

| 관측 | 결과와 범위 |
| --- | --- |
| 원본 CI | actual checkout `3bcabadbd48ed2fe039999c6125a731d442d0223`, job 131945254711에서 core가30초 제한에 도달했다. 시작 콘솔14:30:55.250 → 기대된 Origin400 콘솔14:31:18.400 → timeout 콘솔14:31:26.580 UTC. native POST·entry barrier는 통과했다. source와 정규화 시각은 [original-ci.json](original-ci.json)에 남겼다. |
| 새 worktree 첫 실행 | clean `72fb86c3e8aa5b239c969612575d6d2c278de60b`의 core1은 준비 전 SSR 검색 입력이 disabled인 채30초에 실패했다. document/entry/root/Vite client는200, optimized React Router/JSX 모듈2개는504 `Outdated Optimize Dep`였다. 원본 CI후반과 별개로 보존했다. [baseline.json](baseline.json) |
| 최적화 metadata 생성 뒤 조건부 관측 | 같은 clean source, 새 프로세스·실제 기대값·30초·retry0·reload 우회0에서 core1이 통과했다. test 내부19.549초, Origin 부정까지12.399초, 그 뒤 추가 과업과 context 종료에7.150초였다. 프로세스 완료 UTC14:44:35.057307/KST23:44:35.057307을 별도 계측했다. [conditioned.json](conditioned.json) |

조건부 관측에서 단일 기능 대기의 실패는 없었다. 원래 한 시험은 사진 wizard와6개 screenshot, 익명 권한/프로필, 보완 요청과 잘못된 배지 재시도, 관리자 확인 누락 재시도와 승인, CAS/Origin 부정, 본인 수정과 재심, 재승인, 관리자 회수, 본인 사진 삭제를 한 deadline에 누적했다.

| 조건부 실행 구간 | 누적 시각 | 바로 앞 기록 뒤 경과 |
| --- | ---: | ---: |
| 사진 선언 capture 완료 | 3.241초 | 2.203초 |
| 제출·비공개/owner capture 완료 | 4.571초 | 0.767초 |
| 보완 후 본인 오류 재시도·수정 완료 | 10.887초 | 3.761초 |
| 첫 승인과 CAS/Origin 부정 완료 | 12.399초 | 0.063초 |
| 승인 뒤 본인 수정에 따른 공개 중단 | 15.197초 | 0.316초 |
| 재승인·관리자 회수 뒤 공개 중단 | 17.129초 | 0.240초 |
| 본인 사진 삭제·context 종료 | 19.549초 | 마지막 context 종료0.234초 포함 |

CI 콘솔 시각과 로컬 JS 단계 시계의 측정 경계는 다르다. 원본 CI의 정확한 지연 원인을 단정하지 않고, 여러 독립 사용자 과업을 한30초에 누적하는 구조의 위험을 근거로 root와 분할을 조율했다.

## 승인된 독립 과업과 보존한 검증

1. **사진 제출·승인 전 비공개**: 실제5단계 wizard에서 방문/사진 권리를 입력하고 제출한다. 선언과 본인 화면 capture, 익명 GET/HEAD/preview404, 공개 프로필 빈 상태와 비관리자403을 보존한다.
2. **보완·재시도·승인 공개**: 새 사진 자료를 실제 제출 API로 준비한다. 관리자 보완과 본인 사유 표시, 잘못된 배지의 입력 유지/재시도, 관리자 확인 누락 재시도, 승인 후 사진200/no-store·프로필의 비공개 근거 제외·장소 연결, CAS409/Origin400과 승인 화면 capture를 보존한다. 동일 익명 페이지를 pending 때 열고 승인 뒤 reload한다.
3. **승인본 수정·회수·삭제**: 또 다른 새 자료를 실제 제출 API와4가지 관리자 확인 gate로 승인 준비한다. 같은 review ID와 같은 public/preview 사진 URL에 대해 본인 수정→pending404/profile0→재승인200→관리자 회수404/profile0→본인 사진 삭제/preview404를 검증한다.

각 과업은 새 ID를 만들고 `afterEach`에서 본인 최신 version으로 철회한다. API 준비에는 raw SQL이나 승인 상태 직접 조작을 쓰지 않는다. 일반 문서 POST는 HTML 응답 계약을 유지하며, 준비 승인도 owner의 승인 상태와 실제 공개 사진200으로 확인한다. 기존 native POST와 entry barrier 시험 본문은 계측 checkpoint와 byte 단위로 동일하다. BASE_URL skip·새 context NAVER 차단·동일30초·retry0·모든 기존 보안 부정 기대를 유지한다. 파일 수집은 desktop5건/mobile5건이다.

## 초기 bootstrap 실패의 한계

첫 실행의 외부 font stylesheet2개는200(464.99/652.31ms), font6개도200(최대336.6ms)이었다. 이 실행은 font가 원인이라는 근거를 제공하지 않는다. Vite8.2.0/Cloudflare plugin1.50.0/React Router dev8.3.0을 기존 lock으로 설치했다.

요청 version과 실행 뒤 디스크 metadata top-level 비교는 불일치였지만, 실행 당시 in-memory metadata를 직접 관측하지 않았다. Vite의504 세부 분기는 UNKNOWN이다. info 수준의 재최적화 로그가 없다는 사실로 첫 optimization commit을 배제하지 않는다. 기존 #365 또는 과거 local504와 원인이 같다고 결론내리지 않으며, 단순 include/config/timeout 추가를 하지 않는다. 분할이 이 bootstrap 실패를 해결했다고 주장하지 않는다.

원문 trace는 gitignored 비공개 로컬 파일로 보존하고 요청 헤더·쿠키·본문·원문 trace를 업로드하지 않는다. 기존 UI 화면 증거는 [검수 UI 증거](../cst-reviewer-moderation-20261113/README.md)에 있다.
