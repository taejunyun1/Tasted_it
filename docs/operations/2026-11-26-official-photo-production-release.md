# 공식 장소 사진 운영 배포

## 적용 범위

실제 운영 `retaste-beta`의 100% 버전은 `ff51553c-c8fb-462d-a9ae-a72c4f9e1082`다. [#475](https://github.com/taejunyun1/Tasted_it/pull/475)의 소스 `494c07f56c174df42a3b027b1639772e2d9796b7`와 D1 장부 56개를 읽기 전용으로 확인했다. 새 앱 전체에는 보류 중인 스키마를 읽는 경로가 있다. [56개 장부 호환성 기록](../evidence/cst-runtime-schema-baseline-20261122/summary.json)

병합된 main의 전용 빌드는 위 소스에 검토된 사진 패치를 적용한다. 공식 사진 레지스트리와 표시 컴포넌트는 같은 main 커밋에서 가져온다. 정식 장소 상세와 모바일 시트에 공식 임베드와 작은 원문 링크를 표시한다. 공개 상태·주분류·정확한 상호와 주소를 서버에서 다시 확인하며 폐업과 TEMP 장소를 제외한다. 기존 대표사진을 우선한다. 패치가 적용된 파일과 입력 해시를 빌드 산출물에 기록한다.

차이는 사진 표시, 필요한 CSP 경로, 표시 플래그에 한정된다. 기존 Worker의 두 cron, D1·R2 바인딩, 인증, B09 및 리뷰 흐름을 대조한다. 적용 범위에 D1 마이그레이션·R2 반입·학생 계정·메일·B17·#397은 없다. 이미지 파일을 Worker에서 다운로드하지 않는다.

## 사전 검증

1. 배포 담당자가 병합된 정확한 main의 깨끗한 체크아웃에서 대상 계정·Worker·현재 100% 버전을 대조한다. 기존 운영 버전이 위 값과 다르면 중단한다.
2. 운영 DB의 마이그레이션 순서를 읽어 56개 기준과 비교한다. 파일명 배열은 실제 적용 순서가 기준이다. 0032가 0031 앞에 있다. [Cloudflare D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)
3. 별도 로컬 D1에 56개 장부를 적용한다. 기준과 후보에서 공개 목록·상세, 로그인, 관리자·학생 접근 및 기존 예약 핸들러를 대조한다. 등록 사진의 데스크톱 상세와 모바일 시트에서 원문 링크를 확인한다. 비활성 플래그, 잘못된 상호·주소, 폐업과 TEMP의 비노출을 함께 확인한다.
4. 필수 CI 네 항목과 병합 후, 정확한 main에서 아래 빌드를 재현한다. 생성 설정의 Worker 이름, 운영 DB·R2 바인딩, 두 cron과 비밀값 부재를 대조한다. 승인 범위의 PR 본문과 필수 증거를 모두 확인한다.

```bash
export CLOUDFLARE_ACCOUNT_ID=7543330c65069ee2df1b7b353fb0201c
export WRANGLER_SEND_METRICS=false
release_parent="$(mktemp -d /tmp/retaste-official-photos.XXXXXX)"
node scripts/build-official-photo-release.mjs "$release_parent/candidate"
pnpm exec wrangler deploy --dry-run --config "$release_parent/candidate/build/server/wrangler.json" --profile tastedit-production
```

## 운영 확인과 회수

- 승인 PR에 명시된 빌드만 `wrangler deploy --config`로 1회 배포한다. 환경 시작 전후의 이전 버전, 새 버전과 트래픽 비율을 대조한다.
- 공개 홈·장소 목록·로그인·정책 페이지와 관리자 접근 보호를 확인한다. 승인된 전체 사진 장소의 공개 상세에서 등록된 정확한 임베드와 출처 URL을 읽는다. 대표 1곳에서 데스크톱·모바일의 실제 사진을 확인한다. 기존 RSI 결과의 확인 범위와 데이터 변경 여부를 배포 영수증에 기록한다.
- 공개 상세 실패, 대상 아닌 사진 노출, 인증·보안 헤더나 56개 장부의 예상 밖 차이가 나오면 같은 Worker를 이전 100% 버전으로 롤백한다. 버전과 공개 화면을 다시 대조한다. [Cloudflare 버전과 배포](https://developers.cloudflare.com/workers/versions-and-deployments/)
