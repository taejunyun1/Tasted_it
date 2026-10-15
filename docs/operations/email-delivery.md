# 이메일 발송 실패 확인

가입 메일이 HTTP 503으로 실패하면 Workers 실시간 로그의 `SIGNUP_FAILED`를 확인한다. Resend 응답의 HTTP 상태와 아래 고정 사유만 기록하며, 공급자의 원문 메시지·메일 주소·키·인증 링크는 기록하지 않는다. 가입 화면에는 기존의 일반 오류 안내를 유지한다.

| 로그 사유 | 확인할 설정 |
| --- | --- |
| `TEST_RECIPIENT_RESTRICTED` | `resend.dev` 시험 발신은 계정 소유 주소에 한정된다. 실제 학생에게 보내려면 Resend에서 검증한 발신 도메인이 필요하다. |
| `SENDER_DOMAIN_NOT_VERIFIED` | `RESEND_FROM_EMAIL`의 정확한 도메인 또는 하위 도메인이 같은 Resend 계정에서 검증됐는지 확인한다. 다른 이메일 서비스에서의 검증은 Resend 검증을 대신하지 않는다. |
| `API_KEY_INVALID`, `API_KEY_INACTIVE`, `API_KEY_SUSPENDED`, `API_KEY_RESTRICTED` | 기존 Resend 계정의 키 상태와 발송 권한을 확인한다. 키는 로그나 채팅으로 전달하지 않는다. |
| `API_KEY_FORMAT_INVALID` | Resend가 키를 거절했고 설정 값이 Resend의 `re_` 형식도 아니다. 공급자와 credential 종류가 잘못 연결되었는지 확인한다. 값 자체를 출력하지 않는다. |
| `API_PERMISSION_MISSING` | 기존 토큰의 발송 권한을 확인한다. 필요 이상의 전체 권한을 부여하지 않는다. |
| `UNCLASSIFIED` | 고정 분류에 없는 응답이다. 공급자 대시보드에서 해당 시각의 발송 로그를 확인한다. 원문 로깅을 켜지 않는다. |

설정을 복구한 뒤 소유한 테스트 수신함에서 실제 인증 메일을 확인한다. 수신한 30분 일회용 링크로 인증을 완료하고 정상 로그인을 확인한다. API가 성공하거나 로컬 fake가 통과한 사실만으로 실제 수신·인증을 PASS로 처리하지 않는다. 실사용 학생 초대를 이 시험에 소비하지 않는다.

근거: [Resend 오류 코드](https://resend.com/docs/api-reference/errors), [도메인 불일치 403](https://resend.com/docs/knowledge-base/403-error-domain-mismatch). 기존 Resend 공급자·요금·바인딩·DB 구조는 이 진단 수정으로 변경하지 않는다.

## 지정 도메인 복구

배포 담당자가 `EMAIL_DOMAIN_REPAIR_TARGET`에 소유한 도메인 하나를 지정한 동안에만 `/admin/operations/email-domain`을 사용할 수 있다. 기본값은 빈 문자열이며 ADMIN도 404다. ADMIN 로그인 후 GET은 현재 발신 주소와 지정 도메인의 Resend 인증 상태·공개 DNS 레코드만 반환한다. API 키는 반환하지 않는다. 다른 도메인의 정보는 반환하지 않는다.

같은 출처의 ADMIN POST `intent=create`는 지정한 도메인 하나를 기존 Resend 계정에 등록한다. `intent=verify&domainId=...`는 해당 ID가 지정한 도메인인지 먼저 확인하고 인증을 재요청한다. 도메인 삭제, 키 발급·반환, 다른 공급자 전환 기능은 없다. 외부 변경 전에 기존 관리자 감사대장에 시도를 기록한다. 실제 발신 주소는 배포 담당자가 인증 완료 후 변경하며 원래 값은 비공개 복구 기록으로 보존한다.

DNS에서는 해당 도메인에 Resend가 요청한 발신 SPF·DKIM 레코드만 검토한다. 기존 수신 MX·Cloudflare 발신·DMARC를 덮어쓰지 않는다. 실제 메일 수신·인증 검증이 끝나면 복구 대상 변수를 비워 기능을 끈다. 표준 배포도 빈 기본값으로 되돌린다. 이 기능은 학생 계정에서 사용할 수 없다.
