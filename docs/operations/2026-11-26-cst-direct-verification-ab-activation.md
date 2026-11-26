# 직접인증 A·B 운영 접수

이 실행 PR이 병합되고 선행 운영 영수증이 확인되면 Jay/Codex가 아래 범위의 전환을 진행한다. 기존 Re:Taste 운영 계정의 `tastedit-production`, Worker `retaste-beta`, D1 `DB`, 일반·직접인증 사진용 기존 비공개 R2 바인딩을 사용한다. 계정은 영수증과 대조해 `CLOUDFLARE_ACCOUNT_ID`에 고정하고 작업 기록에는 출력하지 않는다. [#533 접수 종료 전환](2026-11-26-cst-student-dark-release.md) · [#556 직접인증 전환](2026-11-26-cst-integrated-direct-poi-rollout.md)

## 시작 조건과 고정 산출물

- #533의 운영 확인과 #556의 `2911bd4` 배포 영수증, #556 정확한 버전의 정기 RSI 6경로와 해당 시각 D1 감사를 확인한다. 전환 직전에는 그 버전이 단독 100%이고 일반 사진 표시가 켜져 있으며 직접인증 좌석이 미지정인지 다시 읽는다. 장부 59개의 적용 순서와 해시 `c968f4252c2ef02399a8d615b22b4c6ef8cd8b87fb073c65915ca7b4ed55cce2`, 원장 856건·연결 83건, 배포·바인딩과 기존 두 cron을 대조한다.
- #556의 육모정과 #558의 추가 사진은 각자의 영수증에서 상태를 확인한다. 준비되면 #556 버전이 운영 중일 때 실행한다. 미해결 사진을 둔 채 신청 버전을 전환할 때는 진행 중인 관리자 사진 변경을 마친 뒤 전환한다. 전환 뒤 남은 사진은 해당 버전에서 별도로 승인된 범위가 필요하다. 두 작업의 영수증에서 사진 상태와 신청 상태를 각각 기록한다. [#558 사진 범위](2026-11-26-poi-three-originals-followup.md)
- #557 병합 소스 `e0210716b4013d127bc66ab157af926436438f4c`의 보존된 번들 세 개를 아래 지문과 대조한다. 절대 경로 메타데이터 두 필드를 제외한 운영 구성은 접수 좌석만 달라진다. 일반 사진 표시와 기존 직접인증 사진 바인딩을 사용하고 전역 리뷰 사진 업로드는 `false`다.

| 단계 | 좌석 설정 | 빌드 SHA-256 | Wrangler 설정 SHA-256 |
|---|---|---|---|
| 신청·접수 종료 | 미지정 | `0748d832fbf62daf7a95a5e86042e48e3ba847ec1d838b0848f68b36438411e8` | `eb671377de2f7ddd63c37597588fa1b4704c12bb3654aa4218b019264f908d7e` |
| A 접수 | `A` | `3d30238c7a5e58d1d7e58ccee423688cc2063c596adc568f9667190b1639b7ec` | `a977723ed7e46719fd6d7719aab0b40f3fab07c993d399823ac5d3d530efd3a6` |
| A·B 접수 | `A,B` | `6a799a2b4d5481f8fe3d51528bd37ca6c0e7a0725d4101bfade5a35a3dbf5366` | `0ff828a74f496858654985715ea4d5d4fd51622deda620422669c2b30e9816b2` |

## 전환과 실제 참여

1. **신청을 받을 단계.** 접수 종료 번들을 배포해 신청 상태·반려·재신청을 사용할 수 있게 한다. 로그인과 신청 화면, 접근 제한, 관리자 경로, 기존 공개 장소 및 해당 시점에 공개된 사진의 대표 응답을 확인한다. 비로그인 미등록 직접인증 사진 표본은 GET·HEAD 404와 `no-store`를 확인한다. A·B는 인증된 기존 계정으로 각자 신청한다. 안내 발송은 두 수신자·문안에 대한 사용자 확인과 별도 승인된 발송 범위를 따른다.
2. **활동 승인과 A 접수.** 좌석 A의 유효 상태, 인증 계정, 본인 신청과 기존 승인 방문 유무를 읽는다. 기존 승인 방문이 있으면 해당 기록의 게시 시점과 직접인증 범위를 대조한다. 정상 신청을 B08 미리보기와 관리자 재인증으로 확정한다. 신청 당시 기준을 충족하지 못한 예외는 실제 근거가 확인될 때만 사유를 기록해 처리한다. 전환 전에 같은 작업 ID의 확정 영수증과 대상의 적용 결과(APPLIED), 일치하는 감사를 확인한다. 이미 승인됐다면 동일 계정의 근거와 감사만 확인한다. A 접수 번들로 전환해 좌석 설정과 A 본인 화면의 첫 리뷰 사진 안내를 확인한다. B의 접수 제한은 운영 좌석 설정과 합성 차단 증거를 함께 대조한다. B는 이 기간에도 본인 신청을 제출할 수 있다.
3. **첫 A 방문 뒤 A·B 접수.** A가 한 장소를 실제로 방문해 평가를 자기 계정으로 제출하고, 그 평가의 첨부 화면에서 직접 촬영한 사진 한 장을 제출한다. 제출 확인, 작성자 미리보기, 승인 전 익명 GET·HEAD 404, 방문과 사진의 별도 관리자 검수, 공개 화면의 **직접인증** 표기와 출처 링크를 대조한다. 공개 GET·HEAD 200과 GET 바이트는 제출된 JPEG 또는 승인 미리보기를 기준으로 확인한다. A의 검증이 끝나면 B의 신청을 같은 기준으로 확인하고 B08로 승인한다. B의 작업 ID에 연결된 확정 영수증·적용 결과·감사를 확인한 뒤 A·B 번들로 전환한다. B의 한 장소·사진 한 장에서 같은 운영 결과를 확인한다. 참여자의 동의와 제출·공개·철회 기록은 실제 행위에 연결해 비공개로 보존한다.
4. **단계별 운영 증거.** 버전·비율·설정, 공개와 비공개 경계, 동일 버전 RSI 성공과 일치하는 감사 행을 각각 남긴다. 기존에 승인된 내부 실행 경로가 있으면 단계마다 해당 RSI 호출을 최대 한 번 사용한다. 그 경로를 사용할 수 없으면 정기 RSI를 관측한다. 같은 단계의 버전과 운영 증거를 확인한 뒤 다음 트래픽 전환을 시작한다. 실제 계정과 콘텐츠는 참여자 본인이 제출하고 결과는 입증된 만큼 집계한다.

전환 단계마다 `selected_config`는 위 지문을 확인한 설정이고 `new_version`은 실제 업로드 ID다. 업로드 직후 버전의 설정·바인딩과 기존 단독 100%를 다시 대조한 뒤에만 트래픽을 전환한다.

```sh
pnpm exec wrangler versions upload --dry-run --strict --config "$selected_config" --name retaste-beta --profile tastedit-production
pnpm exec wrangler versions upload --strict --config "$selected_config" --name retaste-beta --profile tastedit-production
pnpm exec wrangler versions view "$new_version" --name retaste-beta --json --profile tastedit-production
pnpm exec wrangler deployments status --name retaste-beta --json --profile tastedit-production
pnpm exec wrangler versions deploy "${new_version}@100" --name retaste-beta --yes --profile tastedit-production
```

범위는 세 고정 번들의 업로드·전환 각 최대 한 번, 실제 A·B 신청의 B08 활동 승인 각 최대 한 번, 확인 대상 좌석별 첫 방문·원본 각 한 건의 검수다. 비용은 기존 Worker·D1·R2 사용량이며, D1 마이그레이션·신규 리소스·초대 재발급·보관 기간 변경은 별도다. 수신자·식별자·비밀값은 비공개 영수증에 필요한 최소 범위로 둔다. B17과 #397은 보류한다.

## 중단과 회수

- 대상·해시·버전이 어긋나거나 B08 결과를 확인할 수 없으면 같은 요청을 반복하기 전에 실제 배포·신청과 동일 작업 ID의 영수증·감사를 읽는다. 확정하지 못한 결과는 UNKNOWN으로 남긴다. 초기 접수 종료 전환에서 중대한 회귀가 있고 대상 활동 승인과 실제 방문·사진 제출이 시작되기 전이면 기존 사진 바인딩을 가진 직전 #556 버전으로 한 번 복구한다.
- A·B 접수에서 범위가 어긋나거나 접수 기간이 끝나면, 동일한 `e021071` 접수 종료 버전으로 단계당 한 번 되돌려 새 사진 첨부를 닫는다. `pnpm exec wrangler rollback "$restore_version" --name retaste-beta --yes --profile tastedit-production`의 복구 대상은 영수증과 대조한 정확한 버전이다. 단독 100%와 새 첨부 종료, 기존 심사·사진·R2 정리 경로를 확인한다. 공개 사진에 문제가 있으면 실제 실증 대상 중 해당 사진만 관리자 경로로 한 번 회수하고 익명 GET·HEAD 404를 대조한다. 좌석의 실제 만료 시각을 각 단계 직전에 확인한다. 사용자·방문·감사·D1·R2 기록을 보존한다. [Cloudflare 복구](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

#557 정확한 호환 빌드와 격리 59개 장부에서 신청 결과, 320px 재신청, 관리자 메모 비노출과 과거 중복 상태를 확인했다. 세 설정의 strict dry-run과 일반 사진 구성·접수 좌석 대조도 끝냈다. [신청 증거](../evidence/cst-reviewer-application-outcome-20261126/summary.json) · [좌석별 사진 경계 선행 검증](2026-11-26-cst-student-production-compat.md#후속-후보의-접수-설정-준비)
