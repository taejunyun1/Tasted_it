# 공개 장소 사진 반입과 회수

[추적 #515](https://github.com/taejunyun1/Tasted_it/issues/515) · [학생 리뷰어 실증 #511](https://github.com/taejunyun1/Tasted_it/issues/511)

일반 장소 사진은 직접 방문 승인 리뷰 사진 및 TEMP 사진과 별도로 관리한다. 공개된 일반 장소에서 최신 승인 JPEG를 보여 주고 제공자와 원본 페이지 링크를 사진 아래에 표시한다. 내부 이용 증빙은 공개 응답에서 제외된다. 폐업·회수·업종 제외·주분류 누락·TEMP 또는 비공개 상태에서는 사진 URL이 R2를 읽기 전에 닫힌다.

## 반입 준비

1. 공개 적격 일반 장소의 canonical ID·상호·도로명주소가 확인된 스냅샷과 개별 사진의 원문·작성자/제공자·이용 범위·확인일을 확보한다. 사진과 점포 주소가 정확히 일치해야 한다. 공공누리 1유형이나 별도 이용허락 등 외부 원본의 재사용 근거와 필요한 표기 문구를 확인한다. 플랫폼의 원문 URL은 이용 권리 확인 자료와 함께 기록한다. [공공누리 1유형](https://www.kogl.or.kr/info/licenseType1.do) · [NAVER 접근 정책](https://policy.naver.com/policy/disclaimer.html)
2. 저장할 JPEG 바이트의 SHA-256을 고정한다. 위치·개인정보와 EXIF를 점검한다. 이용 조건에서 허용하는 범위로만 변환한다. 준비 CLI는 이미 검토한 로컬 JPEG를 대상으로 SHA-256·크기·파일 형식·EXIF와 대상의 상호·주소를 대조한다. 원본 URL을 브라우저에서 열 수 있으나 준비 CLI와 공개 Worker는 해당 외부 URL에서 이미지를 가져오지 않는다.
3. 스냅샷은 공개 적격 일반 장소의 배열이며 각 항목은 id·name·address를 가진다. manifest는 schemaVersion 1과 photos 배열을 가진다. 항목 값은 UUID id, place(id·name·address), sourceUrl, attribution, rightsBasis, rightsEvidence, reviewedAt, sha256, file이며 파일은 입력 디렉터리의 JPEG 이름이다. reviewedAt은 밀리초까지 있는 UTC ISO 시각이다. rightsBasis는 OWN_WORK·MERCHANT_PERMISSION·KOGL_1·OPEN_LICENSE 중 해당 값을 쓴다. rightsEvidence에는 검토 근거 참조와 조건을 기록한다.
4. 준비 도구를 실행하면 별도의 비공개 파일에 STAGED 입력 SQL과 정확한 object key·hash·크기가 남는다. 도구는 한 배치에 최대 25장, 사진당 8MiB, 합계 64MiB를 처리한다.

```sh
node --experimental-transform-types scripts/prepare-poi-media.mjs \
  manifest.json eligible-public-places.json local-jpegs private-staging-plan.json
```

## 적용과 회수 기준

- 운영 작업은 전환 PR이 승인한 자원과 상한으로 제한한다. 실행 직전 STAGED 대상의 현행 공개 자격과 상호·주소·주분류·지역·업종·TEMP 여부를 확인한다. 운영 0055와 기타 B17 전환 상태, 후보 Worker/D1 호환성은 기존 런북으로 검증한다. 0063 적용과 사진 기능 활성화는 대기다. B17·#397은 보류다.
- R2의 분리된 장소 사진 prefix에 승인된 key만 준비한다. 실제 바이트를 다시 읽어 SHA-256, JPEG, 크기 및 해당 STAGED id의 출처를 대조한 뒤 승인된 정확한 행만 PUBLISHED로 전환한다. 최초에는 장소 한 곳을 제한 검증한다.
- 비로그인 공개 상세와 모바일 시트에 승인된 사진 및 출처 원문 링크가 표시되는지 확인한다. 직접 GET의 MIME·해시와 HEAD 응답을 대조하고 날짜·출처 근거는 비공개 기록을 남긴다. 공개 에러와 R2 실패가 나오면 사진 제공만 중단하고 장소 상세가 남는지 확인한다.
- 대상 한 장을 회수할 때 정확한 id를 WITHDRAWN으로 전환해 공개 GET·HEAD 404와 일반 상세의 기존 이미지 또는 빈 이미지 처리 복귀를 확인한다. 사진 추가를 중지할 때 POI_MEDIA_PUBLIC_ENABLED 설정을 비운다. 원본·감사 자료와 물리 객체 보존은 승인된 정책에 따른다.
