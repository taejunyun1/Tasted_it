# ADMIN P0 B05 검증

#412 / parent #408. CSV 확인 요청은 서버에 저장한 작업 ID만 전송한다. 2MiB·200행 제한을 업로드와 확정 payload에 적용하며 DRAFT/HIDDEN만 가져온다. 공개 장소는 기존 검수 경로에서 수정한다. 확정 직전 장소의 기존 필드·분류 연결·분류 상태를 동일 D1 transaction에서 확인하고, 전체 행 및 작업 영수증·감사를 한 번에 기록한다.

평가 무효화는 CONFIRMED 사건의 USER/PLACE 및 evidence의 placeId/userId와 일치하는 원본 표만 허용한다. 사건 전이와 표 무효화의 CAS·감사·재계산 enqueue는 원자적으로 수행하며 원본 vote event는 보존한다. B02 operation용 snapshot/build 함수도 제공한다. `/admin/ratings`의 B02 화면 연결은 부모 통합 범위다.

## 필요한 검증 결과

- `vitest run --config vitest.workers.config.ts tests/integration/admin-import-safety.test.ts tests/integration/integrity.server.test.ts`: 16 passed. 교차 출처·변조 confirm, 공개 우회, 장소/분류/연결 stale, 전체 rollback, replay 단일 감사, 다른 사건의 표, 동시 사건 종결, B02 snapshot을 검증.
- `vitest run tests/unit/place-import.test.ts tests/unit/week1-data.test.ts tests/unit/design-system-contract.test.ts tests/unit/h1-scale-contract.test.ts`: 13 passed. CSV 한도·중복·admin 공개 거절, 기존 offline seed와 화면 계약 보존.
- `tsc -b`: passed.
- `BASE_URL=http://127.0.0.1:5185 playwright test tests/e2e/admin-import-safety.spec.ts`: desktop/mobile 2 passed. 로컬 Worker의 격리된 synthetic DB에서 invalid CSV → 서버 preview → 기존 세션의 재인증 요구 및 공개 경로 404를 확인. 별도 fresh-assurance fixture에서도 DRAFT 반영 → 공개 404를 확인했다.
- 화면을 직접 확인했고 horizontal overflow 없음. [desktop](./chromium-preview.png), [mobile](./mobile-chromium-preview.png).
- `pnpm audit`: 기존 lockfile 기준 critical 1 / high 15 / moderate 26 / low 4. 이 변경은 의존성·lockfile을 변경하지 않는다.

B02 common module/migration과 B03 session accessor를 임시로 가져와 로컬 결합 검증했다. 해당 공통 파일은 이 변경의 커밋 소유 범위에 포함하지 않는다. 운영 배포·live RSI 검증은 부모의 병합 후 진행 범위다.
