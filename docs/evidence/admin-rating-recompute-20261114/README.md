# ADMIN B04 요청 작업 재계산 검증

추적: #408 / #411. B02 공통 확인·수락 계약(#415)을 사용한다.

## 동작

- 기존 회귀: 다른 장소의 오래된 PENDING 작업이 있으면 전역 processor가 그 작업을 처리하고, 요청한 장소는 PENDING인데 화면은 완료라고 표시했다. 실제 로컬 D1 테스트로 재현했다.
- 현재: 장소·설정·작업 ID를 미리 확인한 뒤 공통 operation으로 수락한다. 장소/설정/작업 버전이 바뀌면 원자적 검사에서 거절한다. 작업 수락과 실제 완료를 분리한다.
- 수락 후에는 정확한 작업만 조건부 PENDING → RUNNING으로 선점한다. 정기 processor도 같은 선점 함수를 사용한다. 동시 enqueue는 조건부 INSERT와 winner 조회를 한 D1 batch로 실행한다.
- 완료/실패/대기/처리 중/확인 불가를 저장 상태에 맞춰 표시한다. 실패 재시도는 해당 실패 작업의 새 확인 절차를 거친다. 응답을 잃으면 같은 operation receipt로 다시 조회·처리하며 완료 작업을 중복 실행하지 않는다.
- 원시 투표와 기존 스냅샷 보존 규칙, 정기 processor 반환 계약은 유지한다. 새 의존성·migration·cron은 없다.

## 최소 검증

| 검사 | 결과 |
|---|---|
| 요청 장소가 다른 선행 PENDING 작업 대신 처리됨 | PASS |
| preview는 작업을 생성하지 않음; 변경된 preview는 실행 거절 | PASS |
| 공통 receipt 재요청 및 실패 작업 재시도 | PASS |
| 접수 이후 처리 결과 UNKNOWN 및 같은 receipt 복구 | PASS |
| 동시 enqueue / 동일 작업 선점 경합 | PASS |
| 실패 저장 / 자동 재시도 금지 / 설정 변경 작업 오완료 방지 | PASS |
| 관련 D1 통합 3개 파일 | 15 PASS |
| typecheck | PASS |
| `pnpm audit --prod` | 알려진 취약점 0 |
| 실제 로컬 브라우저, Chromium + Pixel 7 | 6 PASS |

브라우저는 별도 로컬 포트와 합성 D1 seed를 사용했다. 운영 서비스/데이터는 이 검증에서 변경하지 않았다. 필수 CI, 병합, 운영 배포와 live RSI 확인은 상위 작업에서 별도 기록한다.

독립 검토에서 발견한 동시 enqueue 경합은 원자적 INSERT·조회와 6개 동시 요청 검사로 수정하고 재검토했다.

## 화면 증거

- [데스크톱 실행 전 확인](desktop-preview.png)
- [데스크톱 정확한 작업 완료](desktop-completed.png)
- [모바일 실행 전 확인](mobile-preview.png)
- [모바일 정확한 작업 완료](mobile-completed.png)

스크린샷의 ID와 장소는 합성 fixture다. 완료 후 해당 작업 링크를 다시 열어 DB에 저장된 COMPLETED 상태와 다른 장소의 PENDING 유지를 확인했다. 모바일 수평 넘침 없음도 확인했다.
