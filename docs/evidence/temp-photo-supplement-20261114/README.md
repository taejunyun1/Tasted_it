# TEMP 사진 보충 화면·회귀 검증

실제 업소 사진이 아닌 합성 fixture로 검증했다. 새로운 NAVER 사진은 로컬 R2 bytes/hash로 정상 응답하며 `UNVERIFIED`와 원문 링크를 표시한다. 기존 공공누리 문구를 붙이지 않는다.

- 단위 2개: NAVER/pstatic 호스트·중첩 HTTP 출처 경계·잘못된 라이선스와 객체 경로 거절.
- D1 통합 1개: 77행 원자 적용, stale version·잘못된 권리값·기존 KOGL 대상 거절, 중복 실행, 다른 manifest 덮어쓰기 거절, 원본 23개/장소/평가 불변, canonical 숨김과 전체 회수, 감사 1회씩 기록.
- 기존 TEMP D1 통합 3개도 함께 통과. 타입 검사 통과, production dependency audit 취약점 0.
- Chromium 실제 SSR 1440×1000 / 390×844: 목록 사진 로딩, 상세 이미지 naturalWidth=1000, 출처/권리 미확인 문구, 가로 overflow=0, 공공누리 오표기=0.

[desktop 합성 상세](desktop.png) · [mobile 합성 상세](mobile.png)

원격 migration·77사진 반입·운영 공개 검증과 구분한다. 실제 수집 자료와 시각 개인정보 점검 기록은 운영 담당자가 별도로 확인한다.
