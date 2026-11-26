# 직접인증 실증 뒤 장소 미디어 운영 전환

이 실행 PR의 병합과 아래 조건이 확인되면 Jay/Codex가 기존 Re:Taste 운영 Worker의 미디어를 전환한다. 고정 후보는 원문 링크, 공식 Instagram·Threads·YouTube 표시, 직접인증·골든픽 호환을 함께 적용한다. 운영 설정에 맞는 후보 한 개를 골라 업로드·트래픽 전환을 각각 최대 한 번 실행한다.

## 실행 전 대조

1. #556의 정확한 운영 버전, 육모정 공개, 정기 RSI 6경로와 같은 실행의 D1 감사를 영수증에서 확인한다. #558의 각 사진은 공개·회수·근거 보류 중 해당하는 상태와 감사가 일치해야 한다. 공개된 일반 사진의 원본 링크와 바이트 해시를 확인한다. 반입·승인·철회 처리 중이거나 결과가 불명확하면 먼저 해당 절차를 마친다. [#556](2026-11-26-cst-integrated-direct-poi-rollout.md) · [#558](2026-11-26-poi-three-originals-followup.md)
2. #563·#568에서 좌석별 실제 방문·사진과 별도 승인, 공개 출처를 검증한 영수증을 확인한다. 현재 Worker의 단독 100%와 실제 접수 상태를 읽는다. A·B 접수 중이면 좌석 설정이 `A,B`이고 각 좌석의 유효 기한이 전환·검증 동안 유지되는지 대조한다. 양쪽 실증 뒤 승인된 접수 종료 상태라면 좌석 변수를 비워 둔다. 신청 단계, A만 접수 중인 단계, 혼합 트래픽과 증거 미확정 상태에서는 보류한다. [#563](2026-11-26-cst-direct-verification-ab-activation.md) · [#568](2026-11-26-cst-golden-keyboard-ab-rollout.md)
3. 영수증의 계정을 `CLOUDFLARE_ACCOUNT_ID`로 고정한다. `tastedit-production`, Worker `retaste-beta`, 기존 라우트·두 예약 작업·비밀 바인딩 이름, D1 `DB`와 비공개 사진 버킷 두 개를 읽어 일치 여부를 확인한다. D1 적용 순서 59개 및 지문 `c968f4252c2ef02399a8d615b22b4c6ef8cd8b87fb073c65915ca7b4ed55cce2`, 원장 856곳과 검수 연결 83건을 대조한다. 직전 버전의 동일 접수 단계 복구 가능 여부를 기록한다.

## 고정 후보

병합 소스 `ff23db224de59181996afd418b16c2783830be8b`에서 `--student-pilot --poi-media --golden-keyboard --photo-source-links`로 생성했다. 조립된 빌드 SHA-256은 `7a4c8d0aec3b26ccd334f8490b5ee5d6d76e70585bf0f173ddfc2adb1e574da2`다. 두 설정의 `POI_MEDIA_PUBLIC_ENABLED`와 `POI_INSTAGRAM_PHOTO_ENABLED`는 `true`, 전역 `REVIEW_PHOTO_UPLOAD_ENABLED`는 `false`다. 이 승인에는 `POI_THREADS_PHOTO_ENABLED=true`와 `POI_YOUTUBE_VISUAL_ENABLED=true`가 포함된다. 생성 경로 메타데이터를 제외하고 각 단계의 이전 승인 설정과 대조했다.

| 실제 접수 상태 | 후보 | 빌드 SHA-256 | Wrangler JSON SHA-256 |
|---|---|---|---|
| 실증 뒤 접수 종료 | `closed` | `413893734c10350c0dcce212f27b789fc68134447ac827c3e2a6754b54a48578` | `b62aa069861d157b9e762333a0a5558ce8d59814aefd5ecb845b5d73313d6bd2` |
| A·B 실증을 검증했고 접수 중 | `ab` | `28ea0eb398285ace1fbef0099430428d5ed423abcecd641055df9d99fb078b2a` | `b56c7e2a8508bfbc4e3bbaaf8fdf7b5bd50a6247de237743fd0d542d163178dc` |

보존 후보의 `buildFingerprint`와 Wrangler JSON 바이트의 `digest`가 모두 일치해야 한다. 설정의 옵션과 바인딩을 확인한 뒤 아래 명령을 사용한다. `traffic_only_config`에는 해당 Worker 이름만 기록한다. SHA-256은 `5b2f73e17dd59400325ed86397fdeb7c0d7b9c9b2f6ff1154c63d97e488f1ac1`다. 버전·설정·경로의 비공개 실행 값은 운영 영수증에 보존한다. [지문과 모의 업로드](../evidence/cst-postpilot-media-rollout-20261127/config-comparison.json) · [A·B에서 접수 종료까지 격리 검증](../evidence/cst-postpilot-media-rollout-20261127/phase-compatibility.json)

## 운영 전환과 확인

1. 현재와 동일한 접수 단계의 후보로 strict 모의 업로드를 한다. 업로드한 버전의 적용 설정과 바인딩을 조회한 뒤 직전 단독 100%와 좌석 상태를 다시 확인한다. 확인이 일치하면 새 버전에 트래픽 100%를 할당한다. 응답이 모호하면 버전 또는 트래픽 상태를 다시 읽고 같은 쓰기 요청을 반복하기 전에 결과를 확정한다. [Cloudflare 버전 전환](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-deploy)

```sh
pnpm exec wrangler versions upload --dry-run --strict --config "$selected_config" --name retaste-beta --profile tastedit-production
pnpm exec wrangler versions upload --strict --config "$selected_config" --name retaste-beta --profile tastedit-production
pnpm exec wrangler versions view "$candidate_version" --name retaste-beta --json --profile tastedit-production
pnpm exec wrangler deployments status --name retaste-beta --json --profile tastedit-production
pnpm exec wrangler versions deploy "$candidate_version@100" --config "$traffic_only_config" --name retaste-beta --yes --profile tastedit-production
```

2. 새 버전 단독 100%, 두 예약 작업과 접수 상태를 읽는다. 일반 사진 원본의 GET·HEAD 200과 바이트·출처, 보류 사진 GET·HEAD 404와 `no-store`, 직접인증 승인 사진의 장소·공개 프로필과 철회 상태를 대표 표본으로 확인한다. 로그인·관리자 진입, TEMP와 미공개 장소 경계도 대조한다. 모바일 320px에서 동일한 대표 사진과 링크를 확인한다. 골든픽 공개 카드가 두 장 이상이면 Tab·Enter·Escape를 확인하고, 카드가 부족하면 그 시나리오는 미검증으로 기록한다.
3. 전환 직전의 공개 일반·TEMP 목록을 기준으로 장소별 원문 링크와 실제 표시를 기록한다. 일반 장소의 로컬 후보는 상세 표시 62곳과 링크만 13곳이며, 다점포 또는 영업 종료 근거가 있는 3곳은 새 연결 보류다. 각 공개 상세를 비로그인 데스크톱에서 한 번 확인하고 320px에서 Threads·YouTube·일반 JPEG·네이버 링크를 대표 확인한다. 새 Threads 사진과 YouTube는 방문자 클릭 후 원본 표시·재생과 단일 **출처**를 확인한다. TEMP는 사진 바이트와 캡션의 링크를 확인한다. 로그인 벽, 외부 응답 제한, 미표시, 출처 불일치는 장소별 미검증으로 남긴다. 원문 링크만 있는 장소의 확인 결과는 인앱 표시 건수와 별도로 기록한다. [78곳 로컬 연결](../evidence/cst-verified-merchant-visuals-20261127/summary.json)
4. 정확한 새 Worker 버전의 RSI 6경로와 동일 실행의 D1 감사를 확인한다. 승인된 기존 관리자 RSI를 이 전환 전체에서 최대 한 번 실행하거나 해당 버전의 정기 실행을 관측한다. 비용은 기존 Worker·D1·R2 사용량과 공개 확인 요청에 한한다. 신규 리소스·추가 예약 작업·마이그레이션·일반/직접인증 콘텐츠 쓰기·참여자 승인·메일은 각 0건이다. 확정된 결과는 SSOT·위키에 반영한다. B17과 #397은 보류한다.

## 복구

공개 범위·미디어·직접인증 경계에 중대한 회귀가 확인되면 영수증에 보존한 직전 동일 접수 단계의 승인 버전을 한 번 복구한다. 복구 직전에 현재 접수 상태와 좌석 만료를 확인한다. 접수 종료나 만료 이후의 복구에는 #563의 승인된 접수 종료 버전만 적용한다. 복구 대상이 미확정이면 트래픽 쓰기를 보류한다.

```sh
pnpm exec wrangler rollback "$restore_version" --config "$traffic_only_config" --name retaste-beta --yes --profile tastedit-production
```

복구 뒤 실제 버전 단독 100%, 현재 접수 상태와 공개·비공개 경계, 기존 원장·승인 사진의 접근을 확인한다. 복구 버전의 동일 RSI·D1 감사 증거를 남긴다. 한 번의 관리자 점검을 이미 사용한 경우는 정기 실행을 관측한다. [Cloudflare 복구](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
