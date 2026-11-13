# 고정 native 재현 의존성

이 두 파일은 기존 native image의 빌드 입력을 보존하는 검증 artifact다. 앱의 현재 의존성 설치에는 쓰지 않는다. 원본은 `741e919aedabdeadd6d46619a35a0105bafdce66`의 같은 이름 파일이며, `native-manifest.pinned.json`의 기존 SHA와 byte 단위로 일치한다.

| 파일 | SHA-256 |
| --- | --- |
| package.json | 257692887405a71fbc959353de45509e0e0edd001eaab4698091d51bfbf73ae1 |
| pnpm-lock.yaml | 3f88797d9a2e666155555976df0b7f0b772e63e4972e707bfe93beb0e31f3f5d |

`native-executor.ts`는 고정 경로·정규파일·canonical 부모·SHA를 검증해 이 bytes만 native 검증과 명시적 build 입력으로 사용한다. 원본 image/pin/runtime/oracle은 변경하지 않는다. 앱 package/lock과 이 fixture는 각각 실행 closure에 결속된다.

이 고정은 기존 의존성 취약점 해결을 뜻하지 않는다. 임의 install/update·최신 앱 lock 복사·digest 자동 갱신을 하지 않는다. 의도적인 native 환경 갱신은 별도 PR에서 runtime·비용·보안·rollback·새 image/manifest를 검증한다. 이 분리를 제거하려면 관련 PR을 revert하고 이전 artifact mismatch 차단 상태를 유지한다.
