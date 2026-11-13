# TEMP100 공개 경로 구현 검증

- 추적: #413 / #408. 이 문서는 운영 공개 완료 증거가 아니다.
- 공개 manifest: 100행, 사진 계획 23장, 사진 미제공 77행. 원본 SHA-256 `d949f94c4a760aa42c2894ff220c0203d272da49a793cbe402dc79e38cedc900`.
- 공개 manifest hash: `6a68e7b2d45c87631d43902bfe07fb31b2c0d8a18f5a2ef32d732f3087cd90a3`.
- 공식 페이지의 대상 상호/주소에 직접 결속된 좌표 63개를 private 원문+SHA와 함께 확인. 나머지 37개는 위치 조회/기존 canonical 재사용 대상으로 남긴다. 지도 기본 중심점은 사용하지 않았다.
- 사진 23개 최종 업로드 파일에서 PIL EXIF 엔트리 0, metadata는 JFIF만 확인. compiler의 JPEG EXIF/XMP/IPTC/comment·PNG text/EXIF·WebP EXIF/XMP 차단도 23개 모두 통과. 별도 private contact sheet에서 인물·차량번호를 육안 검토한다. 이 검토를 모든 개인정보 가능성의 완전 감사로 확대 해석하지 않는다.

## 최소 코드 검증

- 단위: 외부 출처·숫자점수 유입·사진 key·좌표 0·사진 metadata 거절.
- D1 통합: 조회 실패 시 중단/무재시도와 공식 출처 보완, 100행 공개·원자적 실패·중복 영수증, 기존 canonical 보존, 사진 회수와 일반 관리자 재공개 차단, 일회성 operator trigger의 실패 rollback·재실행·정확한 cleanup. R2 사진은 custom metadata 없는 실제 바이트를 해시 검증하며, 같은 주장 해시에 다른 바이트를 넣으면 공개 준비·사진 응답 모두 거절한다. 파일당 8MiB/전체 25MiB 읽기 상한을 적용한다.
- `pnpm run typecheck`, `pnpm audit --prod`(알려진 취약점 0).
- 로컬 실제 SSR의 합성 3행을 사용해 1440px/390px 목록·상세 TEMP 배지/출처/영업 미확인/사진 미제공/noindex를 확인했다. 가로 overflow 0. 아래 합성 화면과 실제 데이터/운영 배포 증거를 구분한다. 실제 사진·원문 증거는 private에 보존한다.

화면: [desktop 목록](list-desktop.png), [mobile 목록](list-mobile.png), [desktop 상세](detail-desktop.png), [mobile 상세](detail-mobile.png).

PR 필수 CI, main 병합, 원격 migration, 100행 입력, R2 23개, live 페이지와 RSI는 운영 담당자가 실제 결과를 확인한 뒤 SSOT에 별도로 기록한다.
