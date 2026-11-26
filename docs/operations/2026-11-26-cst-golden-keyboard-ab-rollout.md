# 직접인증 A·B 접수의 골든픽 호환 번들 전환

이 실행 PR이 병합되고 아래 선행 조건을 확인하면 Jay/Codex가 [#563의 A·B 접수 전환](2026-11-26-cst-direct-verification-ab-activation.md)을 해당 운영 단계에서 한 번 진행한다. 골든픽 키보드 탐색을 포함한 [#567](https://github.com/taejunyun1/Tasted_it/pull/567)의 병합 소스를 사용한다.

## 시작 조건

- #533과 #556의 운영 영수증, #556의 정확한 정기 RSI 6경로와 같은 시각의 D1 감사를 확인한다. #563의 신청·접수 종료와 A 접수를 정해진 순서로 완료한다.
- 현재 운영 Worker가 #563의 검증된 A 접수 버전 단독 100%인지 확인한다. A의 실제 방문 평가·사진이 장소와 작성자 프로필에서 공개된 상태이고, B의 실제 활동 승인 작업 ID와 APPLIED 결과·감사가 일치하는지 대조한다. 안내 메일과 실제 참가자의 신청·제출은 #563의 절차와 승인 범위를 따른다.
- #563의 기존 A·B 번들과 이번 골든픽 A·B 번들의 업로드·트래픽 전환 이력을 읽는다. 둘 다 미실행일 때 아래 후보를 사용한다. 하나라도 실행됐거나 결과가 불명확하면 실제 버전과 운영 영수증을 확인하고 후속 판단을 기록한다.
- 운영 장부 59개의 적용 순서 지문 `c968f4252c2ef02399a8d615b22b4c6ef8cd8b87fb073c65915ca7b4ed55cce2`, 장소 원장 856건·검수 연결 83건, 기존 두 예약 작업과 비공개 사진 바인딩을 대조한다. 공개된 일반 사진의 현재 상태는 실제 영수증을 읽어 기준으로 둔다.

## 고정 산출물

| 항목 | 고정 값 |
|---|---|
| 병합 소스 | `6b95ce062c3ae83721a8435c976aac8776f43f0d` |
| 옵션 | `--student-pilot --poi-media --golden-keyboard` |
| 골든픽 패치 SHA-256 | `430f1eb01416fb05cb0ffed4a43602f7b14f3d2645687bbcc676925ae5412149` |
| A·B 배포 빌드 SHA-256 | `05c602070eb2342b4768a0a82064eaccec123d17253b4930c27c8ed4c8c686f6` |
| A·B 배포 설정 SHA-256 | `ad18a14741b70fc844edb156ac5821850a3eb46bb21096e0267cfeb888ad6ebf` |

A·B 후보의 전체 Wrangler 설정은 기존 #563 A·B 구성과 대조했다. 빌드 생성기의 로컬 경로 두 필드만 달라지고, 공개 장소 사진과 직접인증 두 좌석을 포함한 실제 운영 설정은 일치한다. 격리 장부 59개에서 320px·390px 키보드로 Tab 이동, 동일 장소 Enter, Escape 초점과 가로 위치 복귀를 확인했다. 병합 소스에서 재생성한 번들의 모든 컴파일 파일과 정규화한 설정이 같은 시험 후보와 일치했고, 고정 배포 설정의 strict dry-run도 통과했다. [호환 검증](../evidence/cst-golden-compat-20261126/summary.json)

## 전환과 확인

기존 운영 계정의 `tastedit-production`과 `retaste-beta`를 사용한다. `selected_config`는 위 지문을 검증한 보존 번들의 설정이다. `traffic_only_config`는 같은 Worker `name`만 선언한 설정으로, 트래픽 전환에만 사용한다. 비공개 실행 영수증에 버전과 지문, 읽은 설정을 보존한다.

1. 기존 A 버전과 비율, 현재 장부·바인딩·일반 사진 상태를 읽고 `selected_config`의 지문을 대조한다. `pnpm exec wrangler versions upload --dry-run --strict --config "$selected_config" --name retaste-beta --profile tastedit-production`을 확인한다.
2. `pnpm exec wrangler versions upload --strict --config "$selected_config" --name retaste-beta --profile tastedit-production`으로 한 번 업로드한다. `versions view`에서 그 버전의 A·B 좌석, 일반 사진 공개, 비공개 버킷과 미리보기 비활성을 확인한다. 직전 A 버전이 여전히 100%인지 읽은 뒤 `pnpm exec wrangler versions deploy "${new_version}@100" --config "$traffic_only_config" --name retaste-beta --yes --profile tastedit-production`으로 한 번 전환한다.
3. 실제 버전 단독 100%와 기존 두 예약 작업을 확인한다. 비로그인 장소·기존 공개 사진, 직접인증 표기·프로필, 미등록 사진 GET·HEAD 404와 `no-store`, B의 정상 접수 경계를 대조한다. B의 실제 방문 및 사진 공개 확인은 #563의 절차를 따른다. 공개 골든픽 카드가 둘 이상이면 모바일 Tab·Enter·Escape를 확인한다. 카드가 부족하면 현재 목록과 그 운영 시나리오가 미검증임을 기록한다.
4. 정확한 새 운영 버전의 RSI 6경로와 같은 시각의 D1 감사를 확인한다. #563에서 승인된 내부 확인 경로를 사용하거나 정기 실행을 관측한다.

허용 범위는 위 A·B 번들의 업로드와 트래픽 전환 각 한 번, 지정된 확인과 복구다. D1 마이그레이션, 신규 리소스, 권한 및 보존 정책 변경은 포함하지 않는다. 비용은 기존 Worker·D1·R2 사용량이다. B17과 #397은 보류한다.

## 중단과 회수

후보·지문·바인딩·영수증이 어긋나면 추가 쓰기 전에 실제 상태부터 읽는다. 전환 뒤 골든픽 또는 공개 화면의 중대한 회귀가 있으면 영수증에 고정한 직전 A 버전으로 트래픽을 한 번 복구한다. 사진 접수 범위가 잘못됐거나 기간이 끝나면 #563의 접수 종료 버전과 재검증 절차를 따른다. 기존 방문·사진·감사 기록을 보존하고 복구된 버전 단독 100%와 같은 버전의 RSI·D1 감사를 확인한다.
