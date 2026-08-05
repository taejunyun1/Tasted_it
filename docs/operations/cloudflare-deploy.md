# Cloudflare 배포 런북

## 사전 게이트

- 단위·D1 통합·E2E·타입·빌드 통과
- 실제 장소 최종 검수와 개인정보 처리방침 출시 차단 항목 해소
- 운영자 연락처, `ADMIN_EMAIL`, 강한 `SESSION_SECRET` 확정
- 기존 D1 export와 현재 Worker version 기록

## 최소 권한 로그인

사용자가 현재 터미널에서 `pnpm wrangler login`을 완료한다. API 토큰을 쓸 경우 Workers Scripts 편집, D1 편집, 계정 멤버십 읽기만 허용하며 Global API Key는 사용하지 않는다.

## D1과 비밀값

```bash
pnpm exec wrangler d1 create retaste-production
```

반환된 `database_id`를 `wrangler.jsonc` 운영 설정에 반영한 다음:

```bash
pnpm exec wrangler d1 migrations apply retaste-production --remote
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ADMIN_EMAIL
```

비밀값은 저장소, 셸 기록, 문서에 남기지 않는다.

## 배포와 데이터

```bash
pnpm deploy
```

배포 URL에서 Admin CSV 가져오기로 검증 완료 데이터를 적재한다. 홈, 카테고리, 상세, 로그인, 투표, 저장, 관리자 거부, `/privacy`, `/terms`를 확인한다.

```bash
BASE_URL=https://<worker-url> pnpm test:e2e -- tests/e2e/release.spec.ts
```

## 롤백

오류 시 신규 데이터 공개를 `HIDDEN`으로 전환하고 Cloudflare version rollback으로 직전 정상 Worker를 복원한다. 스키마 변경은 파괴적 역마이그레이션 대신 호환 가능한 전진 수정이 원칙이다. 장애 시간, 영향, 버전, D1 상태, 조치자를 기록한다.
