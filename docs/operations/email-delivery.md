# 이메일 발송 실패 확인

가입 메일이 HTTP 503으로 실패하면 Workers 실시간 로그의 `SIGNUP_FAILED`를 확인한다. Resend 응답의 HTTP 상태와 아래 고정 사유만 기록하며, 공급자의 원문 메시지·메일 주소·키·인증 링크는 기록하지 않는다. 가입 화면에는 기존의 일반 오류 안내를 유지한다.

| 로그 사유 | 확인할 설정 |
| --- | --- |
| `TEST_RECIPIENT_RESTRICTED` | `resend.dev` 시험 발신은 계정 소유 주소에 한정된다. 실제 학생에게 보내려면 Resend에서 검증한 발신 도메인이 필요하다. |
| `SENDER_DOMAIN_NOT_VERIFIED` | `RESEND_FROM_EMAIL`의 정확한 도메인 또는 하위 도메인이 같은 Resend 계정에서 검증됐는지 확인한다. 다른 이메일 서비스에서의 검증은 Resend 검증을 대신하지 않는다. |
| `API_KEY_INVALID`, `API_KEY_INACTIVE`, `API_KEY_SUSPENDED`, `API_KEY_RESTRICTED` | 기존 Resend 계정의 키 상태와 발송 권한을 확인한다. 키는 로그나 채팅으로 전달하지 않는다. |
| `API_PERMISSION_MISSING` | 기존 토큰의 발송 권한을 확인한다. 필요 이상의 전체 권한을 부여하지 않는다. |
| `UNCLASSIFIED` | 고정 분류에 없는 응답이다. 공급자 대시보드에서 해당 시각의 발송 로그를 확인한다. 원문 로깅을 켜지 않는다. |

설정을 복구한 뒤 소유한 테스트 수신함에서 실제 인증 메일을 확인한다. 수신한 30분 일회용 링크로 인증을 완료하고 정상 로그인을 확인한다. API가 성공하거나 로컬 fake가 통과한 사실만으로 실제 수신·인증을 PASS로 처리하지 않는다. 실사용 학생 초대를 이 시험에 소비하지 않는다.

근거: [Resend 오류 코드](https://resend.com/docs/api-reference/errors), [도메인 불일치 403](https://resend.com/docs/knowledge-base/403-error-domain-mismatch). 기존 Resend 공급자·요금·바인딩·DB 구조는 이 진단 수정으로 변경하지 않는다.
