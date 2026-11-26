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

남원 육모정의 TourAPI 대표 사진은 공개 장소 주소와 일치하고 제3유형으로 확인했다. JPEG 원본 한 장을 로컬 반입 계획으로 준비했다. 운영 반입과 공개는 #556의 조건을 따른다. [육모정 원본 사진](https://tong.visitkorea.or.kr/cms/resource/60/2899760_image2_1.jpg) · [전체 프레임 표시 검증](../evidence/cst-poi-original-frame-20261126/summary.json) · [#556 통합 운영안](2026-11-26-cst-integrated-direct-poi-rollout.md)

한국관광콘텐츠랩 사진별 기록에서 부산집 음식 사진 `4163518_3`과 오얏리 돌솥밥 상차림 `2873883`은 제3유형, 새집추어탕 외관 `4060030`은 제1유형으로 확인했다. 부산집 대표 사진 `4163517`은 개별 이용 조건을 확인할 수 없어 보류한다. 부산집과 오얏리 돌솥밥은 사진 안의 원출처 표기를 보존하고 제공자와 원출처를 캡션에 함께 표시한다. 새집추어탕은 관광정보에 천거길 9가 적혀 있지만 사진 속 외관은 요천로 1397 별관을 명시한 춘향제 사진과 일치한다. `2911bd4` 격리 Worker의 첨부·공개·회수 증거는 교체 전 자산 기준이다. 새 부산집 원본의 지문과 `STAGED` 행은 별도 격리 D1에서 대조했다. [세 장 운영 반입](2026-11-26-poi-three-originals-followup.md) · [한국관광콘텐츠랩](https://api.visitkorea.or.kr/#/hubTourSearch) · [제공자 정책](https://knto.or.kr/helpdeskCopyrightguide) · [춘향제 주소와 외관](https://chunhyang.org/bbs/board.php?bo_table=store&wr_id=53) · [교체 전 격리 검증](../evidence/cst-poi-three-licensed-originals-20261126/summary.json)

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

출처 링크를 포함한 후속 후보는 `--student-pilot --poi-media --photo-source-links`로 생성한다. 골든픽 후보에는 `--golden-keyboard`를 함께 지정할 수 있다. `student-pilot-release.json`의 `photoSourceLinks`에 패치와 원문 목록·링크·보안 헤더·TEMP 안내 파일의 지문을 기록한다. 합성 59개 장부에서 복순이네 원문과 젤라또 노베오 Instagram을 확인했다. 후속 후보에서는 옛날두부와 네이버 출처의 데스크톱·320px 경로도 검증했다. Threads 기능은 기본적으로 꺼진다. #556·#563·#568의 실행에는 각 승인 절차의 고정 산출물을 사용한다.

일반 장소 사진을 준비하는 후속 환경은 운영 장부의 56개 뒤에 0065, 0063, 0064 순서로 적용한 59개 장부를 사용한다. 0065가 적용된 환경에서는 기존 57개 순서를 확인하고 0063·0064만 추가할 후보로 지정한다. 관리자 화면에서는 기존 비공개 사진 바인딩의 `poi-media/` 원본을 대조한다. 공개를 승인한 실행에서는 배포 설정에 `POI_MEDIA_PUBLIC_ENABLED=true`를 지정해 상세와 모바일 시트의 사진·원문 링크를 확인한다. 사진 공개 중지와 개별 회수는 아래 기준을 따른다.

59개 장부의 합성 환경에서 관리자 비밀번호 재인증, 승인과 회수 감사, 공개 GET·HEAD의 JPEG 해시 및 회수 뒤 404를 확인했다. 일반 장소 사진과 별도 직접인증 사진이 데스크톱 상세와 모바일 시트에 같이 표시됐다. 공개 변수를 비운 상태와 TEMP 표본의 사진 미노출, 공식 Instagram 대체 표시, 기존 두 사진 저장 경로의 보존도 확인했다. [실행 기록](../evidence/cst-poi-media-compat-20261126/summary.json) · [320px 관리자](../evidence/cst-poi-media-compat-20261126/admin-preview-mobile.png) · [모바일 공개 상세](../evidence/cst-poi-media-compat-20261126/public-photo-mobile.png)

## 업체 원문과 Threads 표시

네이버 플레이스의 업체 사진은 개별 장소의 업체 갤러리로 연결한다. 전라도미가·한마음포차·조단부부의 현재 상호와 상세주소를 대조했다. 다섯 사진의 내부 ID와 원본 경로는 검수 원장에 기록했다. [네이버의 장소 URL 공유 안내](https://help.naver.com/service/30026/contents/20492?osType=COMMONOS)

옛날두부는 사용자가 **Threads에 연결해 사진 보기**를 누르면 Meta 임베드 SDK가 사용하는 해당 공개 게시물 프레임 한 경로를 연다. 이 경로의 실제 음식 사진을 데스크톱과 320px 브라우저에서 확인했다. 프레임이 제한될 때도 **출처** 링크를 표시한다. [Meta 임베드 안내](https://developers.facebook.com/docs/threads/tools-and-resources/embed-a-threads-post) · [검증](../evidence/cst-owner-visuals-20261127/summary.json)

`POI_THREADS_PHOTO_ENABLED=true`는 홈과 공개 장소 탐색 HTML의 지정 프레임에 적용한다. 클릭 시 제공자가 일반 브라우저 요청 정보와 IP를 받을 수 있다. 프레임은 `no-referrer`와 `allow-scripts` 샌드박스를 사용하며 Re:Taste 서버의 외부 API 호출과 사진 파일 저장 비용은 없다. 운영 활성화는 후보와 검증 범위를 지정한 승인 후에 진행한다. 프레임 경로가 바뀌거나 문제가 생기면 플래그를 내려 출처 링크로 돌린다. 담당은 Jay/Codex다.

### 해남군 공개 영상

서성식당은 **YouTube에 연결해 영상 보기**를 누르면 해남군 원본의 개인정보 보호 강화 플레이어를 연다. 서비스 origin과 일반 요청 정보가 YouTube에 전달된다. 장소 URL과 검색어는 Referer에 포함하지 않는다. 320px에서도 플레이어 영역은 200×200px 이상이다. 다른 경로의 문서에서 장소 상세로 이동해 최초 CSP가 영상 경로를 제한하면 **장소 상세 다시 열기**를 제공한다. **출처**는 해남군의 원게시물로 이동한다. [YouTube 임베드 요구사항](https://developers.google.com/youtube/terms/required-minimum-functionality) · [검증](../evidence/cst-county-video-20261127/summary.json)

`--photo-source-links` 후보는 YouTube와 Threads를 기본 비활성으로 생성한다. `POI_YOUTUBE_VISUAL_ENABLED=true`로 켜는 운영 적용은 별도 심사에서 후보와 범위를 고정한다. 문제가 발생하면 YouTube 플래그를 내려 원문 링크로 돌린다. 추가 서버 API, 영상 저장, 스키마 변경과 사용료는 없다.

## 방송사 원본과 개별 사진 게시물

구례 60년전통손두부식당은 KBS 방송 안내의 주소를 대조해 전용 영상의 01:05부터 연결한다. 로컬에서 `localhost` 상세는 실제로 재생됐고 `127.0.0.1` 상세의 플레이어는 YouTube에서 직접 보도록 안내했다. 상세의 **출처**에서는 원본의 해당 시각을 바로 열 수 있다. 팔레스분식은 채널광주 원본에서 상호와 도로명주소를 대조하고 상세 버튼으로 05:20–05:38 구간을 연다. 원본의 유료 프로모션 표시는 상세에도 안내한다. [KBS 방송 안내](https://iaudience.kbs.co.kr/broadcast/9564) · [KBS 원본](https://www.youtube.com/watch?v=kTz_GZQEXZ4&t=65s) · [채널광주 원본](https://www.youtube.com/watch?v=fFQgQMYL8ag&t=320s) · [YouTube 재생 구간](https://developers.google.com/youtube/player_parameters)

광성식당과 착한가리비는 방문 사진과 각 원게시물에 표시된 광한서로 7과 대자로 69를 대조했다. 고부정·고템커피·담양현재국수·들뫼풍경은 업체 이미지가 표시되는 네이버 플레이스 갤러리로 연결한다. 각 상세에 게시자와 단일 **출처**를 제공한다. Facebook과 TikTok은 장소가 일치하는 개별 공개 원게시물과 비로그인 상태에서 실제 동작하는 공식 표시 경로를 확인한 뒤 등록한다. [광성식당 원본](https://carcam-n-garden.tistory.com/69) · [착한가리비 원본](https://hwa2ting.tistory.com/429) · [Facebook 게시물 oEmbed](https://developers.facebook.com/docs/graph-api/reference/oembed-post) · [TikTok Embed Player](https://developers.tiktok.com/docs/en/embed-player)

진월동 목살집은 작성자가 명시한 광복마을6길 1과 영상의 상호를 대조했다. 같은 원본의 02:00부터 조리 장면을 표시한다. [맛집따개 원본](https://www.youtube.com/watch?v=INk0aC5hoK4&t=120s)

담양현재국수는 간판과 객사3길 24 주소가 나오는 04:33부터 음식 장면이 끝나는 04:58까지 연결한다. 전라도미가는 ON리 마을방송국 원본 설명의 필문대로191번길 19와 기존 업체 주소를 대조하고 01:06 상차림부터 연결한다. 영상 표시를 켜면 해당 영상 원문을 **출처**로 열 수 있고, 끄면 기존 네이버 업체 사진 갤러리가 같은 위치에 표시된다. [담양현재국수 게시자 원본](https://www.youtube.com/watch?v=glRm4NcRhac&t=273s) · [전라도미가 게시자 원본](https://www.youtube.com/watch?v=VfODxqfwx9w&t=66s)

오비수산은 장신로19번안길 23-4의 업체가 올린 2026년 6월 10일 영상이 있는 네이버 플레이스 소식 탭에 연결한다. **출처**에서 업체가 게시한 원문 목록을 열 수 있다. [오비수산 업체 소식](https://m.place.naver.com/restaurant/2004979994/feed) · [네이버 공유 안내](https://help.naver.com/service/30026/contents/20492?osType=COMMONOS)

그랑깨는 작성자 설명의 광한서로 52와 영상 속 간판·상차림을 대조한 뒤 01:20부터 연결한다. 영상 표시를 끄면 남원시 사진기록관 원문에 연결한다. [그랑깨 게시자 원본](https://www.youtube.com/watch?v=ZnbtJLRHUzM&t=80s)

대나무골은 원게시자 설명의 태목리 481-7과 원장 도로명 대전로 182를 대조했다. 상세에 2020년 공개 영상임을 표시한다. 복순이네와 엄지빈은 영상에서 각각 남광주시장의 음식과 화순 매장의 간판을 확인하고 기존 관광 자료의 주소와 대조했다. [대나무골 영상](https://www.youtube.com/watch?v=oZOV6I1EbHg) · [도로명 대조](https://findby.co.kr/details/57331-127103286003-st-6a4c28c467acb17848cf135d) · [복순이네 영상](https://www.youtube.com/watch?v=XdOXi2ctQQo) · [엄지빈 영상](https://www.youtube.com/watch?v=g9UdzGNidBA)

한마음포차는 간판, 건물번호와 상차림이 나오는 12:45–13:00, 조단부부는 구례군 영상에서 간판과 마라해장국이 나오는 08:32–08:45를 연결한다. 두 장소의 상세주소를 업체 링크와 대조했다. 각 영상의 **출처**는 원게시물을 가리키며, 영상 표시를 끄면 이어서 볼 수 있는 기존 원문 링크가 나타난다. 조단부부는 로컬 도메인에서 재생을 확인했고 숫자 루프백 주소에서는 제공자의 원문 재생 안내를 확인했다. [한마음포차 원본](https://www.youtube.com/watch?v=bLChzMGGUSI&t=765s) · [조단부부 구례군 영상](https://www.youtube.com/watch?v=UuAk8wjryzY&t=512s)

구수향은 2023년 원게시자 영상의 광주 상호와 돌솥비빔밥, 국립아시아문화전당의 예술길 23-6 주소를 대조했다. 토방닭매운탕은 2026년 영상 12:15–12:25에서 서방로107번길 13 이전 후 외관과 음식을 확인했다. 각 장소의 **출처**는 해당 영상의 원문으로 이동한다. [구수향 원본](https://www.youtube.com/watch?v=aNhumVtW-U4) · [국립아시아문화전당 제휴 목록](https://www.acc.go.kr/main/event.do?PID=0102&action=Read&bnkey=EM_0000009345) · [토방닭매운탕 원본](https://www.youtube.com/watch?v=osYf3qz36HI&t=735s) · [이전 후 주소와 외관](https://refinelive.tistory.com/15)

광성식당·복록수·사거리통골뱅이·원조목살집은 상호와 음식을 대조한 개별 네이버 클립에 직접 연결한다. 광성식당 원문의 협찬 표시는 장소 상세에도 명시한다. 네 곳의 영상은 작성자 원문에서 재생을 확인했고 외부 플레이어 지원 범위는 미확정이다. [광성식당](https://m.blog.naver.com/every100/clip/9398864) · [복록수](https://m.blog.naver.com/fmfun/clip/306388) · [사거리통골뱅이](https://m.blog.naver.com/loveis7108/clip/7801577) · [원조목살집](https://m.blog.naver.com/jiwon4348/clip/5134953)

새 영상 두 곳은 1280px과 320px에서 로컬 장소 상세의 재생 버튼으로 실제 원본을 열었다. 토방닭매운탕은 양쪽 화면에서 12:15에 시작해 지정 구간에서 정지했고, 두 곳 모두 **출처** 링크는 하나였다. 운영 원장과 같은 일반 장소 78곳의 로컬 전체 슬롯 대조에는 합성 프레임과 JPEG를 사용했다. [로컬 검증](../evidence/cst-more-original-sources-20261127/summary.json)

후속 영상 설정은 승인된 실제 운영의 접수 상태에 맞춘다. 접수 종료에는 좌석 변수가 없는 후보를, A·B 접수 중에는 두 좌석만 유지하는 후보를 사용한다. 두 구성 모두 이전 승인 설정과 비교했을 때 영상·Threads 플래그만 추가됐고 엄격한 모의 업로드를 통과했다. 네 가지 일반 장소 JPEG 반입과 실제 방문·사진 확인은 기존 승인 순서를 따른다. 운영 적용은 별도 승인에서 적용 소스와 버전, 지문을 고정한 뒤 진행한다. [설정 대조](../evidence/cst-more-original-sources-20261127/config-comparison.json)

### 사거리통골뱅이·오비수산 영상과 반달곰식당 사진 출처

사거리통골뱅이는 2023년 영상 원문 설명의 충장로58번길 18-2와 통골뱅이탕을 확인했다. 오비수산은 2026년 영상의 외관과 간판을 장신로19번안길 23-4 매장 사진과 대조했다. 두 곳 모두 영상 표시가 꺼진 상태에서는 이전 네이버 **출처**로 연결한다. [사거리통골뱅이 원문](https://www.youtube.com/shorts/edU_JvgAprI) · [오비수산 원문](https://www.youtube.com/shorts/nILy25jCyaI)

반달곰식당은 구례읍 중앙로 88 장소 카드, 간판과 음식 사진이 함께 보이는 작성자 원글을 링크한다. 올더스캣 기존 매장 사진은 운영 종료 공지와 회수 검토가 있어 새로 연결하지 않았다. [반달곰식당 원문](https://m.blog.naver.com/studio_young0425/224365538127) · [올더스캣 B09 기록](2026-11-26-allderscat-b09-recall.md)

### 실키밀키와 자매통닭&호프의 네이버 사진 원문

실키밀키 업체 홈이 현 상호와 첨단내촌로 46-1 1층을 표시한다. 11월 25일 방문 후기가 있고 같은 장소의 아나사쿨라에서 주희케이크로 바뀌었다는 글은 2020년 공지다. 업체 사진 탭을 비로그인 상태로 열어 브런치와 바게트 사진을 확인했다. [업체 사진](https://m.place.naver.com/restaurant/1942978740/photo?filterType=%EC%97%85%EC%B2%B4) · [방문 후기](https://m.place.naver.com/restaurant/1942978740/review/visitor) · [과거 공지](https://m.blog.naver.com/jjaggani2/222049056723)

자매통닭&호프는 천변우로 363-26 장소 카드와 매장·음식 사진이 포함된 2026년 1월 13일 방문기를 확인했다. 두 곳은 각각 사진을 확인한 원문을 **출처**로 연결한다. [자매통닭&호프 원문](https://m.blog.naver.com/sososo2516/224145188426)

## 적용과 회수 기준

- 운영 작업은 전환 PR이 승인한 자원과 상한으로 제한한다. 먼저 후보 Worker 전체의 D1 호환성을 검증한다. 운영 장부와 같은 56개 마이그레이션에 0063·0064를 추가한 로컬 D1은 기존 스키마 객체 420개를 보존했다. 이 검증의 범위는 장소 사진 스키마와 데이터다. 0063·0064 운영 적용과 사진 기능 활성화는 대기다. B17·#397은 보류다.
- 비공개 반입 계획으로 검토된 사진 한 행을 STAGED에 등록한다. 관리자가 **장소 관리 → 장소 사진 관리**에서 사진 ID와 장소·출처·이용 근거를 확인한 뒤 재인증하고 **원본 첨부**에서 계획에 등록한 JPEG를 선택한다. 서버가 크기·형식·해시와 현재 대상 정보를 대조해 정확한 비공개 키에 한 번만 저장하고 감사 이력을 남긴다. 첨부한 사진은 검수 대기 상태이며 관리자가 비공개 미리보기로 확인한다. 최초에는 장소 한 곳을 제한 검증한다.
- 변경 사유를 입력하고 **공개 확정**을 선택한다. 최근 재인증이 없으면 재인증 후 동일 사진을 다시 조회해 사유를 입력한다. 서버는 비공개 R2 JPEG 바이트의 SHA-256·크기·형식, 현재 장소의 공개 자격과 상호·주소, 관리자 세션을 다시 확인한다. 정확한 한 행의 공개 승인과 감사 기록을 한 번에 반영한다. 화면의 서비스 사진 표시가 꺼져 있으면 공개 승인 상태여도 방문자에게 제공되지 않는다.
- 비로그인 공개 상세와 모바일 시트에 승인된 사진 및 출처 원문 링크가 표시되는지 확인한다. 직접 GET의 MIME·해시와 HEAD 응답을 대조하고 날짜·출처 근거는 비공개 기록을 남긴다. 공개 에러와 R2 실패가 나오면 사진 제공만 중단하고 장소 상세가 남는지 확인한다.
- 한 장을 회수할 때 같은 사진 ID로 조회해 사유를 입력하고 **회수 확정**을 선택한다. 승인과 같은 재인증 기준을 적용하며 장소가 비공개이거나 R2를 읽을 수 없어도 회수할 수 있다. 장소 상호나 주소가 바뀌면 0064가 해당 장소의 준비·공개 사진을 자동 회수하고 감사 기록을 남긴다. 회수한 사진은 다시 공개할 수 없으므로 근거를 다시 검토해 별도 신규 행으로 준비한다.
- 회수 후 비공개 미리보기와 공개 GET·HEAD 404, 일반 상세의 기존 이미지 또는 빈 이미지 복귀를 확인한다. 서비스 전체 사진 표시를 중지하려면 POI_MEDIA_PUBLIC_ENABLED 설정을 비운다. 원본·감사 자료와 물리 객체 보존은 승인된 정책에 따른다.
