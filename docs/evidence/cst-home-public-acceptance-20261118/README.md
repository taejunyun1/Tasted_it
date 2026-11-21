# 홈 공개 적격·분류·빈 결과 검증

2026-11-18 · U01/S01 · 코드 `c3147a9` · 자체 compiled Worker/D1에서 desktop/mobile 각1건 PASS. 명령·정확한 테스트 해시·초기 검증 가정 교정·정리 결과는 [summary.json](summary.json)을 따른다.

하나의 흐름에서 실제 후보API와 홈 카드가 공개 적격2곳으로 일치하고, 비공개/회수HIDDEN/PC방 명시 제외를 확인했다. ‘전체 지도’로 전환한 후 실제 음식 분류는 각각1곳을 표시한다. 범위 안0건·범위 밖1건은 자동 이동 없이 명시적 확장을 제공하며, 후보 없는 다른 URL bbox에서는 정상EMPTY를 표시한다.

음식 분류는 browse 화면의 조작이다. 회수 fixture는 저장된HIDDEN 상태이며 관리자 회수 실행 자체를 검증하지 않는다. 지역은URL bbox로 지정했다. 제품 코드·정책·외부 제공자는 바꾸지 않았다. 최초 정리FK/주유소 가정 오류는 기록하고 현행 규칙에 맞춰 시험만 교정했다. 최종 장소·분류·연결 fixture 잔존은0이다.

- [desktop 홈](chromium-curated.png) · [mobile 홈](mobile-chromium-curated.png)
- [desktop 음식 분류](chromium-category.png) · [mobile 음식 분류](mobile-chromium-category.png)
- [desktop 빈 분류](chromium-empty-category.png) · [mobile 빈 분류](mobile-chromium-empty-category.png)
- [desktop 빈 지역](chromium-empty-region.png) · [mobile 빈 지역](mobile-chromium-empty-region.png)
