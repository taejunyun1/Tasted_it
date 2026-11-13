# CI에서 드러난 공통 헤더 반응형 보완

Issue #394의 후속 증거다. #392 원본과 기존 로컬 통과 기록은 수정하지 않았다. #393에서 처음 실행된 Linux 헤더 시험의 실패를 보존하고, 모바일 주요 링크를 기존 네이티브 메뉴 안으로 옮기는 최소 구조 변경을 검증한다. 현재 로컬 GREEN이며 Linux 통합 검증과 이 PR의 최종 필수 CI는 별도 확인한다.

## 최초 실패와 원인 범위

[run43443028545 / smoke131945254711](https://github.com/taejunyun1/Tasted_it/actions/runs/43443028545/job/131945254711)의 실제 checkout은 `3bcabadbd48ed2fe039999c6125a731d442d0223`이다. 전체 결과는 **22 PASS / 2 SKIP / 2 FAIL**이고, 이 중 헤더 시험 1건에서 익명·리뷰어 두 상태 모두 실패했다. 다른 리뷰어 흐름 실패는 별도 담당 범위다. 320px 메뉴 오른쪽은334.921875px, 640px/CSS zoom2에서는669.828125px이며 hit=false였다. 해당 최초 CI에는 실제 렌더링 글꼴 이름이 기록되지 않았으므로 UNKNOWN으로 남긴다.

기존 구조는 브랜드·주요 링크 3개·메뉴를 한 줄에 모두 넣고 축소를 막아, 합계 폭이 가용 폭을 넘을 수 있었다. macOS 기본 글꼴 한 조합에서 간격을 줄인 통과만으로 이 제약을 없애지 못했다. Linux와 macOS 글꼴 폭 차이는 후보이며 최초 CI의 특정 글꼴을 원인으로 단정하지 않는다.

로컬 RED `654a849aad01f8a9b8403488b9e100f5c5f439aa`는 제품 수정 없이 전용 시험을 확장했다. 기본 글꼴은 실제 Pretendard ExtraBold/Medium으로 메뉴 right306px가 통과했다. monospace 스트레스에서는 실제 Courier와 Apple SD Gothic Neo가 사용됐고 right323.421875/646.84375px로 폭 초과가 재현됐다. 이는 Linux 글꼴을 재현한 시험이 아니라 폭 변화에 대한 합성 스트레스다.

## 최소 변경과 로컬 결과

제품 변경은 Header JSX의 기존 메뉴 안 주요 링크 3개와 site-head scoped CSS다. 모바일의 바깥 링크는 숨기고 메뉴 안에 표시하며, 데스크톱은 기존 바깥 링크만 접근 트리에 노출한다. 역할 조건·인증 href·로그아웃 Form·loader·지도·검수 코드는 변경하지 않았다. 메뉴는 기존 44px을 유지하고, 짧은 화면에서는 가용 높이 안에서 세로 스크롤한다. 글꼴 크기나 기존 경계·hit·44px·키보드 기대값, timeout/retry를 완화하지 않았다.

소스 동결 체크포인트는 `3bb60e792c6f023c3864d084349ecac59f741653`이다. 제품과 시험 기대값이 같은 상태에서 로컬 데스크톱/모바일 **2/2 PASS, 29.1초**를 확인했다. 실행 후에는 이미 수행하던 열린 메뉴의 글꼴 조회 다음으로 진단 console 출력 위치만 옮겼다. CDP 명령·제품·기대값은 바뀌지 않았고 시험 파일 타입 검사도 통과했다.

| 조건 | 수정 후 메뉴 / 패널 | 확인 |
|---|---|---|
| 320px, 기본·monospace 각각 | 메뉴 right306px,44×44px | 익명·리뷰어 경계/hit/키보드 통과 |
| 640px/CSS zoom2, 기본·monospace 각각 | 메뉴 right612px,88×88px | 같은 기대값 유지 |
| 1280px 데스크톱 | 기존 right1260px,38×38px | 기존 주요 링크/계정 메뉴 유지 |
| 320×320px 짧은 화면 | 패널 bottom308px,height244px | Tab이 주요 링크·장소 제안·평가·로그아웃까지 노출 |
| 640×640px/CSS zoom2 | 패널 bottom616px,height488px | 같은 하단 도달/hit 통과 |

타입 검사·빌드·전용 시험 파일 TypeScript 검사가 통과했다. 운영 의존성 audit는0건, 개발 의존성 포함 기존46건(low4/moderate26/high15/critical1)이다. 의존성과 lockfile은 변경하지 않았다.

## 파일과 검증 경계

- `ci-first-red.json`: 최초 Linux CI의 전체 결과·실제 checkout·헤더 소유 실패와 UNKNOWN 글꼴.
- `local-red.json`, `local-green.json`: 실제 DOM 경계, 선언/플랫폼 글꼴, keyboard href, 짧은 화면 도달 결과. GREEN에는 두 프로젝트 측정이 포함된다.
- `mobile-reviewer.png`, `mobile-content-zoom200.png`, `desktop-anonymous.png`: 로컬 메뉴 화면.
- `mobile-short-logout.png`: 짧은 메뉴의 Tab 순회 끝에서 하단 로그아웃이 보이는 상태.

로컬 시험은 격리 DB·합성 익명/리뷰어 세션이며 외부 브라우저 요청을 차단했다. 어드민·학생 역할은 기존 조건 보존을 정적으로 확인했으며 동적 시험은 하지 않았다. CDN 웹폰트 성공·실제 Linux 폰트·모든 글꼴 조합·실제 기기 검증은 아니다. CSS zoom2는 콘텐츠 확대 모사이며 브라우저 UI/핀치 확대가 아니다. 이미지 픽셀 폭은 에뮬레이션 device scale factor 때문에 CSS viewport 폭과 다르다. hit는 `elementFromPoint` 좌·중·우 검사이며 실제 세 지점 클릭은 아니다. 모든 대상 href는 Tab 도달, Enter 활성화는 메뉴와 `/places` 링크를 확인했고, 로그아웃은 짧은 화면의 키보드 도달과 hit까지만 확인했다. 짧은 화면은 메뉴 내부 순차 스크롤 도달이며 모든 항목의 동시 가시성을 뜻하지 않는다.

Linux 통합 증거는 #393의 기존 검증 브랜치에서 소스 동결 head를 통합해 별도로 실행하며, 완료 전에는 Linux GREEN을 주장하지 않는다. 운영 배포·원격 D1·유료 API·키/환경변수·메일·전체 T07 인수는 실행하지 않았다.

```sh
env -u BASE_URL pnpm exec playwright test tests/e2e/header-layout.spec.ts --project=mobile-chromium # 제품 수정 전 로컬 RED
env -u BASE_URL pnpm exec playwright test tests/e2e/header-layout.spec.ts # 로컬 GREEN 2/2
pnpm typecheck
pnpm build
pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types node tests/e2e/header-layout.spec.ts
```
