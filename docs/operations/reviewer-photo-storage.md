# 리뷰어 발행 사진 저장소 운영 절차

작성일: 2026-08-13
대상: Re:Taste `REVIEW_PHOTOS` R2 binding, `reviewer_visit_photos` D1 metadata

## 운영 범위와 기본 원칙

- 사진은 리뷰어가 **리뷰 발행**을 누를 때만 R2에 저장한다. 사진만 별도로 임시 저장하지 않는다.
- 원본 파일명·EXIF·GPS·로컬 경로는 저장·로그·응답에 남기지 않는다. 브라우저가 2,000px 이하 JPEG로 다시 만든 파일만 전송한다.
- D1에는 opaque 사진 ID, 내부 object key, JPEG MIME, byte 수, 순서만 저장한다. 사용자는 `/review-photos/:photoId`로만 공개 사진을 본다.
- 공개 사진의 읽기는 발행 리뷰와 D1 metadata 관계를 먼저 확인한다. R2 bucket을 직접 공개하지 않는다.
- EXIF 위치 제안은 Phase 2 검토 항목이며, 이 기능에는 포함하지 않는다.

## 병합 후 최초 준비

아래 명령은 **병합된 PR 본문에서 승인된 운영 담당자만** 실행한다. 이 저장소의 개발·테스트 과정에서는 실행하지 않는다.

```bash
# 운영 버킷과 preview 버킷을 계정에 한 번씩 생성
pnpm exec wrangler r2 bucket create retaste-review-photos
pnpm exec wrangler r2 bucket create retaste-review-photos-preview

# migration 0027까지 원격 D1에 적용
pnpm exec wrangler d1 migrations apply DB --remote

# 코드 배포 뒤 기본값(false)을 유지한 채 공개 읽기 스모크 확인
pnpm run deploy
```

`wrangler.jsonc`의 production bucket은 `retaste-review-photos`, preview bucket은 `retaste-review-photos-preview`다. 로컬과 E2E는 Miniflare의 별도 임시 R2 상태를 사용한다. 운영 bucket 또는 remote D1을 로컬 QA 용도로 사용하면 안 된다.

## 단계적 rollout과 rollback

1. migration과 bucket binding이 배포된 상태에서 `REVIEW_PHOTO_UPLOAD_ENABLED=false`를 유지한다.
2. REVIEWER 계정 한 개로 사진 없는 발행, 사진 1장 발행, 공개 상세 사진, 실패 토스트를 확인한다.
3. 이상이 없으면 환경 변수 `REVIEW_PHOTO_UPLOAD_ENABLED=true`로 전환하고 배포한다.
4. 오류율·비용·삭제 실패가 기준을 넘으면 flag를 즉시 `false`로 바꿔 **새 업로드만** 중지한다. 이미 발행된 사진의 읽기·정리 route는 유지한다.

rollback은 flag를 끄고 문제가 된 배포를 직전 `main` Worker로 되돌리는 방식이다. 이미 적용한 D1 migration은 되돌려 수정하지 않는다. 사진 row와 object는 삭제 경계로 정리한다.

## 제한·비용·관측

- 최대 5장, 최종 JPEG는 파일당 8MiB·리뷰당 합계 25MiB다. 브라우저는 decode 전 원본도 파일당 12MiB·합계 36MiB에서 차단하고, 2,000px 이하로 축소해 모바일 메모리 사용량을 제한한다.
- 보수적인 입력 상한은 리뷰 1,000건당 25GiB다. 실제 평균 JPEG 크기와 월 R2 저장량·Class A/B 읽기 요청을 대시보드에서 주 단위로 점검한다.
- 첫 30일의 기준은 업로드 실패율 2% 이하, 삭제 실패율 0%, 공개 이미지 404 비율의 급증 없음이다.
- 공개 route의 5xx와 사진 발행 오류율은 Workers Observability에서 집계한다. 정기 정리 실패는 `REVIEW_PHOTO_CLEANUP_PENDING` 구조화 로그로 **실패·대기 건수만** 남긴다. object key, 파일명, GPS, 원본 공급자 오류 메시지는 로그에 쓰지 않는다.
- 발행 전에는 예정 object key만 가진 `reviewer_photo_cleanup_jobs`를 먼저 기록한다. R2 응답이 모호하거나 D1 발행이 실패하면 기존 일일 평가 정기 작업이 다음 실행(최대 약 24시간)에서 exact key만 재시도해 지운다. 발행 batch가 성공하면 해당 job은 같은 D1 batch에서 사라진다.

## 삭제와 정합성 점검

현재 계정 탈퇴/리뷰 삭제 UI는 없다. 향후 그 lifecycle을 구현할 때는 사용자 또는 리뷰 parent row를 지우기 **전에** 다음 server boundary를 호출해야 한다.

- 단일 리뷰: `deletePublishedReviewerVisitPhotos(db, bucket, reviewId)`
- 리뷰어 전체: `deleteReviewerPhotoObjectsForUser(db, bucket, reviewerUserId)`

두 함수는 D1 metadata의 정확한 key만 페이지당 최대 100개로 삭제하며 R2 bucket listing을 사용하지 않는다. R2 delete가 실패하면 metadata를 남겨 재시도할 수 있게 한다. 성공 시에만 해당 photo row를 제거한다.

공개 사진 응답은 브라우저에서 최대 1시간, edge에서 최대 24시간 캐시될 수 있다. 삭제 성공 후에도 이미 받은 URL이 최대 24시간 동안 캐시에서 보일 수 있으므로, 삭제 요청 처리 화면과 운영 안내에는 이 가시성 지연을 함께 고지한다. cache 만료 후에는 metadata 경계 때문에 404가 반환된다.

정기 정합성 점검은 먼저 D1에서 `reviewer_visit_photos` 건수·합계 byte 수를 집계하고, 삭제 실패/공개 404가 발생한 **opaque ID 목록**만 권한 있는 운영자가 제한적으로 재시도한다. bucket 전체 나열·무작위 삭제는 금지한다.

## 장애 대응

| 증상 | 즉시 조치 | 이후 확인 |
| --- | --- | --- |
| 업로드 실패 증가 | flag를 `false`로 전환 | R2 상태와 `PHOTO_STORAGE_FAILED` 개수 확인 |
| 발행 후 사진 404 | photo ID가 공개 route에 존재하는지 확인 | metadata와 R2 객체의 정확한 key만 재검증 |
| 삭제 실패 | parent 삭제를 진행하지 않음 | 동일 boundary를 재시도하고 `PHOTO_CLEANUP_FAILED` 종류만 기록 |
| 발행 실패 뒤 사진이 남음 | 새 업로드 flag를 필요 시 끄고 cleanup job 수 확인 | 다음 일일 작업이 exact key를 재시도하는지, 24시간 후에도 job이 남는지 확인 |
| 비용 급증 | flag를 끄고 업로드를 중지 | 최근 30일 object/byte/읽기 추이를 검토 |

## 개인정보 보관 기준

발행된 사진은 리뷰의 공개 근거로 제공된다. 사용자가 발행하지 않으면 사진은 브라우저의 짧은 preview URL에만 존재한다. 발행이 실패하면 즉시 삭제를 시도하고, 실패·모호한 R2 응답에는 cleanup job이 exact key만 재시도한다. 리뷰 또는 계정 삭제가 구현되면 위 삭제 boundary를 같은 요청 흐름에 포함해 객체와 metadata를 함께 제거해야 한다.
