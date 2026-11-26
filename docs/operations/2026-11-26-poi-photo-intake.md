# 공개 장소 사진 반입과 회수

[추적 #515](https://github.com/taejunyun1/Tasted_it/issues/515) · [학생 리뷰어 실증 #511](https://github.com/taejunyun1/Tasted_it/issues/511)

일반 장소 사진은 직접 방문 승인 리뷰 사진 및 TEMP 사진과 별도로 관리한다. 공개된 일반 장소에서 최신 승인 JPEG를 보여 주고 제공자와 원본 페이지 링크를 사진 아래에 표시한다. 내부 이용 증빙은 공개 응답에서 제외된다. 폐업·회수·업종 제외·주분류 누락·TEMP 또는 비공개 상태에서는 사진 URL이 R2를 읽기 전에 닫힌다.

## 공식 Instagram 사진 게시물

지점과 사진이 일치하는 공개 게시물에 한해 Instagram이 제공하는 원본 임베드를 장소 상세와 모바일 상세에 표시한다. 사진 아래에 작은 **사진 출처 · Instagram 원문** 링크가 보인다. Worker가 사진 파일을 가져오거나 R2에 복사하는 단계는 없으며, 등록한 원문 경로만 브라우저 프레임에서 허용한다. [Instagram 공개 게시물 임베드](https://developers.facebook.com/documentation/instagram-platform/oembed)

저장소에 등록한 36곳의 각 장소 ID·상호·상세주소와 게시물 1개를 대조했다. 공개 장소 조건, 폐업, TEMP와 현재 식별 자료는 상세 화면을 열 때 다시 검사한다. 새 게시물을 추가할 때는 운영 원장과 공식 작성 계정, 첫 화면에 표시되는 실제 매장·메뉴 사진, 비로그인 임베드 표시를 확인한다. 공동 업체 계정의 다른 지점, 행사 포스터, 현 주소 폐업 공지는 사진 후보에서 제외한다. 여러 장에 개인 사진이 함께 있으면 메뉴 사진 단독으로 표시되는 공식 임베드를 확인한다.

추가한 9곳은 마일드 스탠다드, 스테이케이션, 코롬방제과점, 음악이 흐른다, 룩투, 트레비아, 피트, 다수, 땡스덕 베르베르의집이다. 현재 매장 또는 업체가 직접 게시한 메뉴 사진을 확인했으며 코롬방제과점의 사진은 2024년 게시물이다. 대상과 원문의 연결은 [검수 레지스트리](../../app/features/poi-media/instagram-photos.ts)를 따른다.

이어서 코테의 라운지, 도리스하우스의 쿠키, 홈댄스의 계절 메뉴 사진을 확인했다. 세 곳의 주소와 공식 계정을 대조했고 공개 임베드에서 사진만 담긴 화면을 확인했다.

광주 코이로의 초밥과 사시미, 기찻길옆 황제식당의 해산물 상차림, 복덩이네의 한우, 장흥 전골 부엌의 버섯전골 사진을 추가했다. 네 곳의 상세주소와 업체 계정 연결을 대조하고 비로그인 임베드에서 사진을 확인했다. 복덩이네 사진은 2025년 설 선물세트 게시물이며 현재 판매 여부는 미확인이다. [코이로 업체 정보](https://m.place.naver.com/restaurant/2035791750/home) · [기찻길옆 황제식당 업체 정보](https://m.place.naver.com/restaurant/2046569219/home) · [복덩이네 업체 정보](https://m.place.naver.com/restaurant/1319568628/home) · [전골 부엌 업체 정보](https://m.place.naver.com/restaurant/2052397308/home)

오푸르베이커리의 빵 진열대, 무아의 바노피 디저트, 스시에이와의 초밥, 해남의 아침 커피로스터리의 커피 사진을 추가 검수했다. 업체 계정과 매장 주소, 비로그인 공식 임베드 표시를 대조했다. 네 곳은 운영 상세에서도 확인했다. [#529 운영 영수증](https://github.com/taejunyun1/Tasted_it/pull/529) [오푸르베이커리 업체 정보](https://m.place.naver.com/restaurant/2023163929/home) · [무아 업체 정보](https://m.place.naver.com/restaurant/2085184749/home) · [스시에이와 업체 정보](https://m.place.naver.com/restaurant/2053505823/home) · [해남의 아침 커피로스터리 업체 안내](https://m.blog.naver.com/haenamcoffee/224208955664)

젤라또 노베오의 실제 사진과 원문 링크를 합성 로컬 환경의 데스크톱 상세·모바일 시트에서 확인했다. 운영 D1에서 최종 후보의 ID·상호·주소·공개 상태는 읽기 전용으로 대조했다. [데스크톱](../evidence/cst-instagram-photos-20261126/desktop.png) · [모바일](../evidence/cst-instagram-photos-20261126/mobile.png)

일반 빌드 설정의 `POI_INSTAGRAM_PHOTO_ENABLED`는 기본 미지정 상태다. 운영 호환 빌드는 플래그를 활성화했다. #529에서 30곳의 상세·출처와 대표 실제 사진의 데스크톱·모바일 표시를 대조했고, 대조 TEMP 장소의 상세에는 공식 임베드가 표시되지 않았다. 이 경로는 기존 D1을 읽으며 사진 파일은 R2에 반입하지 않는다. 게시물이 삭제되거나 변경되면 등록 항목을 철회한다. 전체 회수는 승인된 [운영 배포 절차](2026-11-26-official-photo-production-release.md#운영-확인과-회수)를 따른다. [#529 운영 영수증](https://github.com/taejunyun1/Tasted_it/pull/529) 네이버 블로그는 현 단계에서 외부 공유 원문 링크의 근거로 사용한다. [네이버 블로그 외부 공유](https://help.naver.com/service/5593/contents/15416) · [네이버 API 약관](https://developers.naver.com/products/terms/)

## 후속 사진 5곳

몰리의 타코, 물밀소의 빵 진열대, 타마의 철판 오징어, 오스테리아 타닥의 마르게리타와 파스타, 돈키호테의 군산 매장 외관을 등록했다. 공개 원장의 정확한 상세주소와 공식 계정, 비로그인 임베드의 실제 정지 사진을 대조했다. 물밀소와 타닥의 단일 사진 출처는 Instagram이 같은 공식 묶음 게시물의 원문으로 연결한다. 다섯 곳의 운영 업데이트는 대기다. [몰리 업체 정보](https://m.place.naver.com/restaurant/2056343825/home) · [물밀소 이전 안내](https://www.instagram.com/p/DOiKOH-gdDJ/) · [타마 업체 정보](https://m.place.naver.com/restaurant/1171348154/home) · [오스테리아 타닥 업체 정보](https://m.place.naver.com/restaurant/2095578776/home) · [돈키호테 주소·계정](https://www.injangsa.com/place/587?page=4&sod=asc&sst=wr_subject)

살림프리미엄채식뷔페 두암점은 공식 사진과 주소를 확인했다. 사업자가 다른 지점을 함께 운영해 체인 제외 기준을 대조할 때까지 사진 등록을 보류한다. [업체 안내](https://m.blog.naver.com/salimbuffet)

군산 커피사랑은 신창동 4-6 1층의 초원사진관점으로 대조했다. 업체 공식 계정이 게시한 보수 후 외관 사진에서 같은 지점 상호를 확인했다. 비로그인 상태에서 정지 사진이 임베드로 표시됐고, 출처 링크는 같은 업체의 원문으로 연결됐다. 운영 갱신은 대기다. [업체 주소와 계정](https://www.daangn.com/kr/local-profile/%EC%BB%A4%ED%94%BC%EC%82%AC%EB%9E%91-kogepffzb3z5/) · [Instagram 원문](https://www.instagram.com/p/DXfY0Srk8qF/)

## 반입 준비

공공누리 제3유형으로 확인한 대표 사진은 `OPEN_LICENSE`로 준비하고 이용 근거와 원문을 항목별로 남긴다. 원본 JPEG를 그대로 보관하고 상세와 모바일 시트에 전체 프레임을 표시한다. 사진 밖 캡션에 제공자와 원문 링크를 둔다. 사진 속 저작권 표시가 원천 메타데이터와 다르면 제공 권한과 정확한 작성자를 대조할 때까지 공개를 보류한다. [한국관광공사 관광정보 API](https://www.data.go.kr/data/15101578/openapi.do) · [공공누리 제3유형](https://www.kogl.or.kr/info/licenseType3.do)

남원 육모정의 TourAPI 대표 사진은 공개 장소 주소와 일치하고 제3유형으로 확인했다. JPEG 원본 1개를 로컬 반입 계획으로 준비했다. 부산집과 오얏리 돌솥밥은 원본 안에 별도 출처 표시가 있어 해당 제공 권한을 확인 중이다. 운영 반입과 공개는 대기다. [육모정 원본 사진](https://tong.visitkorea.or.kr/cms/resource/60/2899760_image2_1.jpg) · [전체 프레임 표시 검증](../evidence/cst-poi-original-frame-20261126/summary.json)

1. 공개 적격 일반 장소의 canonical ID·상호·도로명주소가 확인된 스냅샷과 개별 사진의 원문·작성자/제공자·이용 범위·확인일을 확보한다. 사진과 점포 주소가 정확히 일치해야 한다. 공공누리 1유형이나 별도 이용허락 등 외부 원본의 재사용 근거와 필요한 표기 문구를 확인한다. 플랫폼의 원문 URL은 이용 권리 확인 자료와 함께 기록한다. [공공누리 1유형](https://www.kogl.or.kr/info/licenseType1.do) · [NAVER 접근 정책](https://policy.naver.com/policy/disclaimer.html)
2. 저장할 JPEG 바이트의 SHA-256을 고정한다. 위치·개인정보와 EXIF를 점검한다. 이용 조건에서 허용하는 범위로만 변환한다. 준비 CLI는 이미 검토한 로컬 JPEG를 대상으로 SHA-256·크기·파일 형식·EXIF와 대상의 상호·주소를 대조한다. 원본 URL을 브라우저에서 열 수 있으나 준비 CLI와 공개 Worker는 해당 외부 URL에서 이미지를 가져오지 않는다.
3. 스냅샷은 공개 적격 일반 장소의 배열이며 각 항목은 id·name·address를 가진다. manifest는 schemaVersion 1과 photos 배열을 가진다. 항목 값은 UUID id, place(id·name·address), sourceUrl, attribution, rightsBasis, rightsEvidence, reviewedAt, sha256, file이며 파일은 입력 디렉터리의 JPEG 이름이다. reviewedAt은 밀리초까지 있는 UTC ISO 시각이다. rightsBasis는 OWN_WORK·MERCHANT_PERMISSION·KOGL_1·OPEN_LICENSE 중 해당 값을 쓴다. rightsEvidence에는 검토 근거 참조와 조건을 기록한다.
4. 준비 도구를 실행하면 별도의 비공개 파일에 STAGED 입력 SQL과 정확한 object key·hash·크기가 남는다. 도구는 한 배치에 최대 25장, 사진당 8MiB, 합계 64MiB를 처리한다.

```sh
node --experimental-transform-types scripts/prepare-poi-media.mjs \
  manifest.json eligible-public-places.json local-jpegs private-staging-plan.json
```

## 운영 기준선과 호환되는 후보

직접인증과 일반 장소 사진을 함께 검증하려면 최신 소스에서 장소 사진 경로를 선택한 후보를 만든다.

```sh
release_dir=$(mktemp -d)
node scripts/build-official-photo-release.mjs "$release_dir/candidate" --student-pilot --poi-media
```

`student-pilot-release.json`의 `poiMedia`에 공개·관리 패치와 복사한 소스의 지문, 필요한 0063·0064의 파일 지문을 남긴다. 후보의 공개 사진 변수와 직접인증 사진 접수는 초기 미지정 상태다. 0065까지만 있는 실증 후보는 기존 `--student-pilot`로 생성한다.

일반 장소 사진을 준비하는 후속 환경은 운영 장부의 56개 뒤에 0065, 0063, 0064 순서로 적용한 59개 장부를 사용한다. 0065가 적용된 환경에서는 기존 57개 순서를 확인하고 0063·0064만 추가할 후보로 지정한다. 관리자 화면에서는 기존 비공개 사진 바인딩의 `poi-media/` 원본을 대조한다. 공개를 승인한 실행에서는 배포 설정에 `POI_MEDIA_PUBLIC_ENABLED=true`를 지정해 상세와 모바일 시트의 사진·원문 링크를 확인한다. 사진 공개 중지와 개별 회수는 아래 기준을 따른다.

59개 장부의 합성 환경에서 관리자 비밀번호 재인증, 승인과 회수 감사, 공개 GET·HEAD의 JPEG 해시 및 회수 뒤 404를 확인했다. 일반 장소 사진과 별도 직접인증 사진이 데스크톱 상세와 모바일 시트에 같이 표시됐다. 공개 변수를 비운 상태와 TEMP 표본의 사진 미노출, 공식 Instagram 대체 표시, 기존 두 사진 저장 경로의 보존도 확인했다. [실행 기록](../evidence/cst-poi-media-compat-20261126/summary.json) · [320px 관리자](../evidence/cst-poi-media-compat-20261126/admin-preview-mobile.png) · [모바일 공개 상세](../evidence/cst-poi-media-compat-20261126/public-photo-mobile.png)

## 적용과 회수 기준

- 운영 작업은 전환 PR이 승인한 자원과 상한으로 제한한다. 먼저 후보 Worker 전체의 D1 호환성을 검증한다. 운영 장부와 같은 56개 마이그레이션에 0063·0064를 추가한 로컬 D1은 기존 스키마 객체 420개를 보존했다. 이 검증의 범위는 장소 사진 스키마와 데이터다. 0063·0064 운영 적용과 사진 기능 활성화는 대기다. B17·#397은 보류다.
- 비공개 R2의 장소 사진 prefix에 검토된 key를 준비하고 비공개 반입 계획으로 해당 행을 STAGED에 등록한다. 관리자에서 **장소 관리 → 장소 사진 관리**를 열어 사진 ID로 조회한다. 비공개 미리보기, 장소 상호·주소, 출처·제공자·이용 근거를 대조한다. 최초에는 장소 한 곳을 제한 검증한다.
- 변경 사유를 입력하고 **공개 확정**을 선택한다. 최근 재인증이 없으면 재인증 후 동일 사진을 다시 조회해 사유를 입력한다. 서버는 비공개 R2 JPEG 바이트의 SHA-256·크기·형식, 현재 장소의 공개 자격과 상호·주소, 관리자 세션을 다시 확인한다. 정확한 한 행의 공개 승인과 감사 기록을 한 번에 반영한다. 화면의 서비스 사진 표시가 꺼져 있으면 공개 승인 상태여도 방문자에게 제공되지 않는다.
- 비로그인 공개 상세와 모바일 시트에 승인된 사진 및 출처 원문 링크가 표시되는지 확인한다. 직접 GET의 MIME·해시와 HEAD 응답을 대조하고 날짜·출처 근거는 비공개 기록을 남긴다. 공개 에러와 R2 실패가 나오면 사진 제공만 중단하고 장소 상세가 남는지 확인한다.
- 한 장을 회수할 때 같은 사진 ID로 조회해 사유를 입력하고 **회수 확정**을 선택한다. 승인과 같은 재인증 기준을 적용하며 장소가 비공개이거나 R2를 읽을 수 없어도 회수할 수 있다. 장소 상호나 주소가 바뀌면 0064가 해당 장소의 준비·공개 사진을 자동 회수하고 감사 기록을 남긴다. 회수한 사진은 다시 공개할 수 없으므로 근거를 다시 검토해 별도 신규 행으로 준비한다.
- 회수 후 비공개 미리보기와 공개 GET·HEAD 404, 일반 상세의 기존 이미지 또는 빈 이미지 복귀를 확인한다. 서비스 전체 사진 표시를 중지하려면 POI_MEDIA_PUBLIC_ENABLED 설정을 비운다. 원본·감사 자료와 물리 객체 보존은 승인된 정책에 따른다.
