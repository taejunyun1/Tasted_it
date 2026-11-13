# 공통 헤더 320px 경계 검증

Issue #391의 로컬 합성 fixture 증거다. 제품 수정은 `app/styles/design-system.css`의 모바일 공통 헤더 규칙 8줄이며, 기존 링크·네이티브 details·헤더 높이·지도·리뷰어 기능·인증 코드는 그대로다. 전체 T07 인수 또는 운영 검증의 통과를 뜻하지 않는다.

## 재현과 결과

2026-11-13, 제품 기준 `f0ca8e02da04f350f0d2e60259cd94ce51a4d91d`에서 전용 시험 `c73e6da13b42fa5bca826193b0c213a86ad03623`만 추가해 먼저 RED를 확인했다. 제품 수정은 `2605eab92245eae838a080c0871953847387da96`이며, 모바일 메뉴의 정규화 크기 44px 최소 기대값까지 추가한 최종 시험 체크포인트는 `166db042e3ce3eb6ef65b4f814e97ebe6e44d3f1`이다. 이 상태의 데스크톱 Chromium·Pixel 7 에뮬레이션 2건이 21.2초에 통과했다. 각 시험은 익명/로컬 리뷰어 상태와 320px, 640px/CSS zoom 2, 1280px를 확인한다.

| 메뉴 측정 | RED 오른쪽 / 폭 | GREEN 오른쪽 / 폭 | 결과 |
|---|---:|---:|---|
| viewport 320px, zoom 1 | 321.703 / 38px | 306 / 44px | 화면 안에 포함, 좌·중·우 지점 hit 통과 |
| viewport 640px, CSS zoom 2 | 643.359 / 76px | 612 / 88px | 화면 안에 포함, 좌·중·우 지점 hit 통과 |
| viewport 1280px, zoom 1 | 1260 / 38px | 1260 / 38px | 기존 데스크톱 경계 유지 |

기존 코드에서도 Tab으로 메뉴에 도달해 Enter로 열고 링크를 순회할 수 있었다. 수정은 좁은 화면에서 잘리던 시각적·포인터 접근을 보완한다. GREEN은 브랜드와 메뉴 경계, 주요 링크 3개, 익명의 로그인/회원가입, 리뷰어의 장소 제안/리뷰어 평가에 대한 화면 경계와 좌·중·우 `elementFromPoint` hit-test를 확인했다. 각 지점에서 실제 클릭을 실행한 시험은 아니다. 모든 대상 href는 Tab 도달을 확인했고, Enter 활성화는 메뉴와 `/places` 링크에 한정했다. 리뷰어 로그아웃은 표시만 확인했으며 로그아웃 실행이나 나머지 링크의 목적지 화면은 이 시험에서 검증하지 않았다. 최초 탐색 시험에서 남아 있던 스크롤 위치는 측정 전에 맨 위로 초기화하도록 시험을 교정했으며, 그 상태에서 다시 제품 RED를 보존했다.

원인은 기존 `.site-head nav` 규칙이 모바일 `.site-head__nav`보다 우선하여 내부 가로 스크롤과 폭 규칙이 남던 CSS 충돌이다. 헤더에 한정한 우선순위 교정, 간격 축소, 메뉴 크기 44px로 보완했다. 문서 전체 가로 넘침만으로 헤더 잘림이 없다고 판단하지 않았다.

## 증거 파일

- `red.json`, `green.json`: 익명/리뷰어의 실제 DOM 경계와 키보드 도달 href. GREEN에는 두 프로젝트 측정이 모두 포함된다.
- `mobile-before.png`: 수정 전 320px/zoom 1/Pixel 7 에뮬레이션/로컬 리뷰어.
- `mobile-reviewer.png`: 같은 조건의 수정 후 열린 메뉴.
- `mobile-content-zoom200.png`: 640px viewport에서 CSS zoom 2로 콘텐츠를 확대한 열린 익명 메뉴.
- `desktop-anonymous.png`: 1280px 데스크톱의 열린 익명 메뉴.

## 실행과 한계

```sh
env -u BASE_URL pnpm exec playwright test tests/e2e/header-layout.spec.ts --project=mobile-chromium # 제품 수정 전 RED
env -u BASE_URL pnpm exec playwright test tests/e2e/header-layout.spec.ts # GREEN 2/2
pnpm typecheck
pnpm build
pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types node tests/e2e/header-layout.spec.ts
```

타입 검사·빌드·시험 파일 타입 검사가 통과했다. 운영 의존성 audit는 0건이며 개발 의존성까지 포함한 기존 audit는 low 4/moderate 26/high 15/critical 1이다. 의존성과 lockfile은 변경하지 않았다.

테스트는 격리 로컬 DB와 합성 세션만 사용하고 브라우저의 로컬 이외 요청을 전부 차단했다. 따라서 웹 폰트 실패 시의 로컬 fallback 글꼴 조건이며, CDN 웹 폰트 로딩 성공이나 모든 글꼴 조합을 검증한 것은 아니다. CSS zoom 2는 브라우저 UI 확대·핀치 확대나 실제 기기 검증이 아니다. 스크린샷은 에뮬레이션 device scale factor로 저장되어 이미지 픽셀 폭이 viewport CSS 폭과 다르다. 데스크톱/모바일 각 1개 브라우저 프로젝트의 지정 폭만 검증했다. 운영 배포·실제 지도 SDK/타일·실제 사용자 세션·전체 T01~T08 검증·네트워크 장애 복구는 이 증거의 범위에 없다.
