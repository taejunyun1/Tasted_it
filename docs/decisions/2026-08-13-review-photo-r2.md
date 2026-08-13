# 리뷰어 발행 사진 R2 저장소 결정

- **상태:** CONDITIONAL GO — 이 기능 PR 병합 전에는 로컬 Miniflare 테스트만 허용한다.
- **작성일:** 2026-08-13
- **추적:** [GitHub Issue #93](https://github.com/taejunyun1/Tasted_it/issues/93)
- **담당:** Re:Taste 제품·운영 담당자

## 문제와 선택

리뷰어가 남긴 사진은 현재 브라우저 미리보기 이름만 남고 발행 데이터에는 저장되지 않는다. 공개적인 리뷰 근거 사진을 최대 5장까지 보존·제공하기 위해 Cloudflare R2 `REVIEW_PHOTOS` binding을 도입한다. D1에는 opaque 사진 ID와 저장 key·크기·순서만 저장하며 공개 요청은 앱 resource route가 발행 리뷰 관계를 확인한 뒤 R2에서 읽는다.

R2 public bucket URL과 base64 D1 저장은 선택하지 않는다. 전자는 발행 취소·삭제와 접근 경계를 통제할 수 없고, 후자는 D1 용량·백업·쿼리 비용을 불필요하게 키운다.

## 환경·비용·개인정보 경계

- 로컬은 Miniflare R2, preview는 `retaste-review-photos-preview`, 운영은 `retaste-review-photos`를 사용한다.
- 운영 bucket 생성과 binding 반영은 PR 병합 후 운영 담당자가 수행한다. 이 브랜치는 원격 bucket, 원격 D1, 배포를 변경하지 않는다.
- 파일당 8MiB, 리뷰당 5장·25MiB까지만 허용한다. 기본 flag `REVIEW_PHOTO_UPLOAD_ENABLED=false`로 시작한다.
- 사진 원본 파일명, EXIF·GPS, 로컬 경로는 저장·로그·응답에 포함하지 않는다. 브라우저 재인코딩 JPEG만 전송한다.
- 객체와 D1 metadata는 리뷰/계정 삭제 시 D1 metadata의 정확한 key 목록으로 제거한다. bucket listing을 삭제 수단으로 사용하지 않는다.

## 실패·관측·롤백

- 업로드 또는 D1 발행 실패 시 리뷰를 발행하지 않고 R2 객체를 best-effort 삭제한다.
- 로그에는 사진 수, 총 바이트, 제한된 오류 종류만 기록한다. key·파일명·원본 공급자 오류는 기록하지 않는다.
- R2 장애 또는 비용 이상 시 flag를 `false`로 바꿔 신규 업로드를 중지한다. 이미 발행된 사진은 읽기 route를 유지한다.
- 예상 사용량은 리뷰 1,000건 기준 최대 25GiB 입력 상한이다. 실제 rollout 전 운영자는 R2 요금제의 저장·Class A/B 요청 한도와 alert 기준을 PR에 기록한다.

## 재검토·제거 조건

업로드 성공률, 평균 사진 크기, 삭제 실패율, R2 월 비용을 30일 동안 관찰한다. 실패율이 2%를 넘거나 비용 한도를 넘으면 flag를 끄고 보상 삭제/정리 절차를 실행한다. EXIF 위치 제안은 이 결정을 확장하지 않으며 별도 Issue·번들 측정·개인정보 검토 후에만 다룬다.
