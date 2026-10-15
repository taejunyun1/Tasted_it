# 업로드 무결성과 Cloudflare AI 보조 검사 검토

검토일: 2026-10-15. 상태: 제안, 모델 호출·새 권한 연결·운영 기능 확장 미실행. 학생 작업공간의 분류 기능과 별도 도입 판단이며 현재 자동 검사 완료를 뜻하지 않는다.

## 판단

도입 가치는 있다. 코드로 확인할 수 있는 파일·권한·저장 무결성을 먼저 강제하고, Workers AI는 사진·설명·점포의 불일치나 추가 확인이 필요한 내용을 표시하는 데 한정하는 구성이 적합하다. 학생의 현장 확인·교차 검토와 운영자의 최종 공개 판단은 유지한다. AI의 정상 응답은 파일 안전성, 저작권, 실제 방문, 사실 일치의 증명이 아니다.

Cloudflare 관리화면의 Agent Lee와 서비스 내부 Workers AI는 용도가 다르다. [Agent Lee](https://developers.cloudflare.com/agent-lee/)는 계정 설정·binding·일부 진단을 읽는 관리 보조 도구다. 업로드 이벤트마다 서비스 파일을 검사하는 루틴은 별도 Worker 로직과 모델 호출로 구현해야 한다. 새 Agents SDK·Durable Object를 처음부터 도입할 필요는 없다.

## 현재 코드에서 확인한 경계

- 학생 작업공간은 분류 사유·근거 링크·QA 기록만 받는다. 아직 학생용 사진·CSV 파일 업로드 API가 아니다. 원천·리뷰·평가를 바꾸지 않는다.
- 관리자 CSV는 `admin-import.tsx` → `parsePlaceCsv` → `importPlaceRows`로 이어진다. 파일 단계 2MiB 제한과 행별 스키마·좌표 범위 검증·미리보기가 있으나, confirm 요청은 클라이언트가 보낸 CSV를 다시 파싱한다. 미리보기 hash·서버 저장 batch와 묶인 확인 토큰, confirm 본문 실측 상한, 행 수 상한을 추가할 지점이다. 현재 status에는 PUBLISHED가 허용되고 같은 slug는 기존 점포를 갱신하므로 신규 등록 전용 심사와 충돌하지 않게 DRAFT 반입·변경 diff·별도 공개 검수를 먼저 설계해야 한다. 학생에게 이 관리자 권한을 주지 않는다.
- 기존 리뷰어 사진 경로는 `reviewer-ratings.tsx` → `reviewer-visit-publish.server.ts` → `reviewer-photo.ts` → R2 저장 → D1 기록이다. 기본 설정의 사진 업로드는 false다. 학생에게 리뷰어 역할을 자동 부여하지 않는다.
- 기존 사진 검증은 최대 5장, 파일당 8MiB, 합계 25MiB, JPEG MIME·시작/끝 signature, APP1 메타데이터 거부를 확인한다. 시작/끝 signature만으로 전체 JPEG 디코딩·악성 파일·모든 메타데이터 제거가 증명되지는 않는다.
- `reviewer-photo.server.ts`는 현재 SHA-256을 계산해 R2 put checksum이나 D1과 대조하지 않는다. 파일 중복·이미지의 의미·학습된 개인정보 탐지를 검사하는 루틴도 아니다.
- 저장 실패·DB 실패 시 객체 정리와 잔여 정리 작업은 기존 경로에 있다. 이는 공개 전 내용 검수를 의미하지 않는다.
- 업종 보조 검증 코드 `ai-category-verifier-v2.server.ts`는 지정 후보·근거만 받아 AI 출력 스키마를 확인하고 자동 판정을 낮출 수 있게 설계되어 있다. 운영 `wrangler.jsonc`에는 AI binding이 없으므로 이 코드의 존재만으로 현재 모델이 가동된다고 판단하지 않는다.
- 기존 6시간 RSI는 공개 경로 HTTP 응답 점검이다. R2 파일 checksum·D1 관계·업로드 권한·모델 품질 검사로 해석하지 않는다.

## 권장 루틴

| 순서 | 처리 | 실패 시 |
| --- | --- | --- |
| 1 접수 권한 | 활성·기한·본인 계정·배정 ID를 확인. 학생과 관리자 모두 같은 검증을 적용 | 거부, 객체 생성 안 함 |
| 2 실제 파일 검사 | 스트림 총량 제한, MIME·magic·디코딩·픽셀 수·폭탄 방어, 안전한 재인코딩, EXIF 제거 | 거부 또는 비공개 보류 |
| 3 저장 무결성 | 업로드 원본 SHA-256과 정제본 SHA-256을 구분. 정제본 checksum을 R2 put에 전달하고 D1에 기대값·크기·형식·버전 기록 | 저장 성공으로 표시하지 않음 |
| 4 비공개 보관 | 객체와 검수 record 연결. 검수 전에는 공개 사진 endpoint가 객체를 반환하지 않음 | HOLD, 관리 목록에 원인 표시 |
| 5 AI 보조 | 배정 점포의 최소 사실과 정제된 작은 이미지로 관련성·흐림·노출 우려 등 검토 사유 제안 | UNKNOWN 또는 RETRY, 통과 처리 안 함 |
| 6 사람 확인 | C·D가 사실·권리·사진 연결을 교차 확인. 운영자가 공개 승인 | 보완 요청 또는 명시적 거부 |
| 7 재검사 | 버전·hash 변경 때 과거 AI/사람 승인을 무효화. 공개 전 다시 검사 | 이전 승인 재사용 금지 |
| 8 정합성 점검 | 배치별 D1↔R2 존재·크기·SHA-256, 중복·고아 객체·미완료 작업 대조 | 검토 대상으로 올리고 무단 삭제·공개 안 함 |

[R2 put checksum](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2putoptions)은 저장 바이트 일치 확인에 쓸 수 있다. multipart ETag는 전체 파일의 SHA-256이 아니므로 대체 지표로 쓰지 않는다. 저장할 원본의 hash와 실제 제공되는 정제본의 hash를 혼동하지 않는다. 관리자가 R2 콘솔에 직접 올린 객체는 서비스 접수·배정·검수 이력을 거치지 않으므로 공개 승인 대상이 될 수 없다.

처음에는 관리자의 검증 실행 버튼으로 최대 25건씩 처리하고, 실패·대기만 다시 처리한다. 안정성 증거와 새 기술 승인 전에는 기존 maintenance `Promise.all`·RSI cron에 작업을 끼워 넣지 않는다. 장시간 처리가 필요하면 별도 승인 범위에서 D1 작업표 또는 Workflows/Queues를 비교한다. `waitUntil` 한 번만으로 유실 없는 작업 완료를 보장하지 않는다.

CSV는 원본 bytes hash·정규화 rows hash·parser/rule version·확인자·확정할 변경 diff를 서버 batch에 묶고, confirm이 그 batch를 한 번만 소비하게 한다. 중복 slug·지역·활성 말단 업종·원천 근거·기존 공개 자료 덮어쓰기를 코드로 검사한다. AI에는 개인정보 필드를 뺀 상호·음식 종류·허용 후보만 주어 의심 행을 표시하게 한다. AI가 CSV 내용을 수정하거나 PUBLISHED로 바꿀 수 없어야 한다. CSV 내보내기를 추가하면 spreadsheet 수식 주입도 별도로 방어한다.

## AI 계약과 운영 한도 제안

- 출력: `PASS_WITH_NOTES / REVIEW_REQUIRED / REJECT_SUGGESTED / UNKNOWN`, 허용 사유 code, 근거 항목, model/prompt/rule version. 실제 공개·수정 도구나 관리자 credential을 모델에 주지 않는다.
- 파일 속 문구와 학생 입력은 자료다. “검사를 건너뛰라”는 문구를 지시로 실행하지 않는다. 임의 URL fetch, 도구 실행, SQL, 파일 경로를 모델 출력에서 받아 실행하지 않는다.
- 모델 응답을 엄격한 스키마로 확인한다. 틀린 JSON·낮은 확신·오류·시간 초과·quota 초과는 UNKNOWN으로 두고 사람 확인으로 넘긴다. 정상 사용자 저장은 AI 가용성에 의존하지 않되 비공개 상태를 유지한다.
- 재시도 중복 방지 키: `uploadId + sanitizedSha256 + modelVersion + promptVersion`. 객체가 바뀌거나 검수 버전이 바뀌면 오래된 작업 결과를 조건부 update로 거부한다. 일일 한도는 호출 **전에** 원자적으로 예약한다.
- 첫 실증 한도 제안: 최대 60장, 이미지당 최초 1회·일시 오류 재시도 최대 1회, 총 최대 120회·일일 최대 20회. 하루 한도 초과는 대기. 이는 무료 보장이나 비용 승인이 아니다.
- 모델은 [공식 vision 모델 목록](https://developers.cloudflare.com/workers-ai/models/)에서 회귀 표본 성능·한국어 근거·응답 비용을 비교한 후 고정한다. Llama 4 Scout는 후보일 뿐 선정된 모델이 아니다. [공식 요금](https://developers.cloudflare.com/workers-ai/platform/pricing/)상 일일 10,000 Neurons 무료 할당과 초과 과금 구조가 있으나, 모델·이미지·토큰별 실측 없이는 장당 비용을 확정하지 않는다. 선택한 모델의 사용량에서 금액 상한을 산출해 PR에 기록한다.
- [Workers AI 데이터 정책](https://developers.cloudflare.com/workers-ai/platform/data-usage/)은 명시적 동의 없이 Customer Content를 모델 학습·서비스 개선에 사용하지 않는다고 설명한다. 모델별 라이선스, 처리 위치와 서비스 개인정보 고지, 직접 저장하는 R2/D1·로그의 보존은 별도로 확인한다. 사람·전화번호·영수증·차량번호가 있는 사진은 선별·가림 후 보내고 원문 prompt·이미지를 분석 로그에 남기지 않는다. AI Gateway 등 새 로그 저장소를 기본 추가하지 않는다.

## 실제 도입 전 통과할 시험

위조 MIME, 손상 JPEG, 과대 픽셀, metadata, 동일/다른 hash, 배정 외 업로드, 기한 만료, 잘못된 계정, 이중 업로드, R2 실패, DB 실패, 검수 전 조회 차단, 모델 timeout·잘못된 JSON·명령문 삽입, 중복 재시도·과거 버전 응답, 일일 한도 동시 호출, 사람 판정과 AI 불일치, 삭제 후 잔여 객체를 시험한다. 모델과 고정 회귀 표본의 오탐·누락을 확인하고 부족하면 수동 운영한다.

Agent Lee의 실제 계정 진단은 별도 읽기 권한 연결이 필요하다. 관리화면에서 Workers Scripts·D1·Workers AI와 필수 Account Settings·User Details의 5개 읽기만 선택한 미인증 상태까지 확인했다. 쓰기·DNS·로그·Zero Trust 권한을 연결하지 않았다. 최종 인증 전 사용자 확인이 필요하며, Agent Lee가 계정을 진단했다거나 검사 루틴이 작동했다고 주장하지 않는다.

도입 구현은 새 업로드 목적·학생 권한·사전 비공개 저장 상태·보존기간·모델·회귀 결과·비용 상한·실행 담당자·rollback을 명시한 후 별도 PR로 결정한다. 본 학생 분류 PR은 새 AI binding·추론 호출·업로드 권한을 켜지 않는다.
