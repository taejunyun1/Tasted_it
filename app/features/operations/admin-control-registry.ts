export const ADMIN_CONTROL_AREAS = [
  { id: "overview", label: "운영 현황" }, { id: "content", label: "콘텐츠" },
  { id: "people", label: "사람·권한" }, { id: "review", label: "검수·평가" },
  { id: "operations", label: "작업·공급자" }, { id: "privacy", label: "개인정보·감사" },
  { id: "recovery", label: "배포·복구" },
] as const;

export type AdminControlArea = (typeof ADMIN_CONTROL_AREAS)[number]["id"];
export type AdminControlFilter = AdminControlArea | "all";
export type AdminControlStatus = "READ_ONLY" | "PARTIAL" | "NOT_IMPLEMENTED";
export type AdminControlEntry = {
  id: string; title: string; area: AdminControlArea; task: string;
  status: AdminControlStatus; href: string | null; currentPermission: "ADMIN" | null;
  currentScope: string; nextStep: string; operatingState: "UNVERIFIED";
};

// Display inventory only. Each destination enforces its own server-side permission.
function control(id: string, title: string, area: AdminControlArea, task: string, status: AdminControlStatus, href: string | null, currentScope: string, nextStep: string): AdminControlEntry {
  return { id, title, area, task, status, href, currentPermission: href ? "ADMIN" : null, currentScope, nextStep, operatingState: "UNVERIFIED" };
}

export const ADMIN_CONTROL_REGISTRY: readonly AdminControlEntry[] = [
  control("A01", "운영 홈", "overview", "현황·메뉴 확인", "READ_ONLY", "/admin", "장소·검수 집계와 관리 경로 조회", "각 작업의 실행 결과와 운영 증거 연결"),
  control("A02", "회원", "people", "검색·제한·복구", "PARTIAL", "/admin/members", "최소 정보 검색·접근 제한·세션 회수", "재인증 후 미리보기와 확정"),
  control("A03", "관리자·세션", "people", "권한 부여·회수·접속 해제", "PARTIAL", "/admin/identities", "재인증·현재 권한 검사·마지막 실제 관리자 보호·세션 철회", "세부 권한 정책과 통합 감사 검색 확장"),
  control("A04", "리뷰어 자격", "people", "신청 심사·정지·휴면", "PARTIAL", "/admin/reviewers", "신청·현재 근거 구분, 재인증·버전 검사와 행별 결과", "실제 운영 심사와 승인 근거 검수"),
  control("A05", "학생 계정", "people", "초대·활성·중지", "PARTIAL", "/admin/students", "초대 미리보기·최초 링크, 재발급·접근 버전 검사", "실제 초대 전달·수락 운영 확인"),
  control("A06", "학생 업무", "people", "배정·교차검수·취소", "PARTIAL", "/admin/students", "배정·취소 원자 확정, 버전 경합과 행별 결과", "실제 학생 작업·교차 검수 운영 확인"),
  control("A07", "장소 목록·상세", "content", "검색·수정·공개·숨김", "PARTIAL", "/admin/places", "장소 목록·단일 회수 영향 미리보기·재인증 확정", "실제 운영 변경의 수용 검증과 원천/표시값 통합"),
  control("A08", "제안·정정", "content", "승인·보완·반려", "PARTIAL", "/admin/place-operations", "제안·정정 처리, 제안 승인은 비공개 초안", "후속 공개 결과와 요청 이력 연결"),
  control("A09", "CSV 반입", "content", "검증·미리보기·반영", "PARTIAL", "/admin/import", "200행/2MiB 미리보기·재인증·원자 반입, 공개 대상 덮어쓰기 차단", "반입 이력 검색과 정정 workflow 연결"),
  control("A10", "장소 검수·분류", "content", "원천 확인부터 최종 공개", "PARTIAL", "/admin/place-operations", "5단계 검수·단일 공개 영향 미리보기와 원자 확정", "검수 앞 단계의 일괄 결과와 실행 관측 통일"),
  control("A11", "병합·복원", "content", "중복 병합·회수 역작업", "PARTIAL", "/admin/place-operations", "병합 영향 미리보기·사유·원자 확정과 검증된 회수 역작업", "병합 자동 분리와 임의 과거 필드 복원은 미지원"),
  control("A12", "영업 상태·추천 제외", "content", "상태 확인·제외 해제", "PARTIAL", "/admin/place-operations", "영업 상태 판정과 추천 제외 해제", "공개·폐업·추천 제외를 구분한 영향 확인"),
  control("A13", "방문·사진 검수", "review", "승인·보완·반려·공개 회수", "PARTIAL", "/admin/reviewer-visits", "현재 버전과 검수 항목을 확인하는 전환", "대기 기한과 삭제 대기·감사 연결"),
  control("A14", "사진 삭제", "privacy", "삭제 대상·처리 결과 확인", "NOT_IMPLEMENTED", null, "소유자 철회·탈퇴 경로 외 관리자 화면 없음", "공개 회수와 영구 삭제를 구분한 처리 확인"),
  control("A15", "평가 설정", "review", "현재 규칙·버전 확인", "READ_ONLY", "/admin/ratings", "현재 활성 평가 설정 조회", "규칙 변경안 비교·승인·버전 활성화 절차"),
  control("A16", "평가 작업", "review", "재계산 접수·완료·실패 확인", "PARTIAL", "/admin/ratings", "정확한 작업 상태·실행 기한·대기 취소·제한 재시도와 결과 재조회", "실제 운영 조치·다른 종류의 작업과 운영 증거 연결"),
  control("A17", "조작 사건", "review", "검토·확정·표 무효화", "PARTIAL", "/admin/ratings", "대상 사건·투표 결속, 최근 인증·미리보기·동시 변경 검사·감사", "통합 감사 조회와 사건별 상세 이력"),
  control("A18", "임시 이용·개인화", "privacy", "승계 실패 상태 확인", "NOT_IMPLEMENTED", null, "개인 선택 경로 외 관리자 화면 없음", "세션 원문 없이 승계 상태·처리 시각 조회"),
  control("A19", "개인정보 요청", "privacy", "열람·정정·삭제 접수", "NOT_IMPLEMENTED", null, "자기 탈퇴 외 통합 요청 관리 화면 없음", "본인 확인·보존 범위·처리 기한·실패 재시도"),
  control("A20", "보존 정리", "privacy", "만료 자료·정리 결과 확인", "NOT_IMPLEMENTED", null, "정기 정리 작업의 개별 관리 화면 없음", "대상별 예상 건수·결과·실패 대기열 조회"),
  control("A21", "원장 정합성", "privacy", "읽기 감사·누락 탐색", "READ_ONLY", "/admin/audit", "조회 상한과 불완전 결과를 표시하는 감사", "실행 간 비교와 발견 사항 처리 추적"),
  control("A22", "관리자 감사", "privacy", "변경 주체·대상·결과 확인", "PARTIAL", "/admin/activity", "50건 cursor 감사·영수증 조회, 작업별 연결과 재계산 상태 확인", "추가 도메인 이력 연결과 제한된 내보내기 검토"),
  control("A23", "공공데이터", "operations", "수집·진행·실패·재개", "PARTIAL", "/admin/data-sync", "인허가 수집 미리보기·재인증·페이지 원자 처리·중단 및 제한 재개", "외부 호출의 실측과 별도 검증 작업의 사용량 연결"),
  control("A24", "NAVER·지도", "operations", "사용량·검증·좌표 확인", "PARTIAL", "/admin/place-operations", "지역별 예산·사용량과 장소 검증", "실측·추정 구분과 동시 호출 한도 보완"),
  control("A25", "AI·부가 공급자", "operations", "호출·비용·실패 관측", "NOT_IMPLEMENTED", null, "통합 공급자 비용 관리 화면 없음", "비밀값 없이 규칙·건수·추정·실측 조회"),
  control("A26", "주차·EV·코스", "operations", "신선도·동기화 확인", "PARTIAL", "/admin/jobs/parking", "주차·EV 작업 상태·현재 사용 자료·취소·제한 재시도 조회", "실제 수집 결과 검증과 코스 운영 연결"),
  control("A27", "기능·긴급 중단", "operations", "설정 조회·중단·재활성화", "NOT_IMPLEMENTED", null, "환경 설정은 지정 운영 절차로 관리", "허용된 설정의 기대값·실효값·복구 기록 조회"),
  control("A28", "정기·수동 작업", "operations", "진행·취소·회복", "PARTIAL", "/admin/operations", "일부 실행 처리량·실패 집계", "개별 작업 상태와 실행·취소 결과 연결"),
  control("A29", "RSI 점검", "operations", "고정 공개 경로 점검", "PARTIAL", null, "보호된 점검 경로는 있으나 전용 결과 화면 없음", "최근 성공·실패와 감사 기록 연결"),
  control("A30", "경보·장애", "overview", "오류 조회·해결 처리", "PARTIAL", "/admin/operations", "열린 경보 조회와 사유를 남기는 해결 처리", "조사·해결·재개와 실제 복구 근거 구분"),
  control("A31", "백업·복구", "recovery", "백업 확인·복원 검증", "NOT_IMPLEMENTED", null, "지정 운영 절차로 관리, 앱 내 복구 화면 없음", "백업 무결성과 격리 복구 검증 증거 연결"),
  control("A32", "배포·환경", "recovery", "승인·배포·복구 추적", "NOT_IMPLEMENTED", null, "PR과 지정 운영 도구로 배포", "배포 버전·환경·라이브 점검 결과 연결"),
  control("A33", "서비스 문안·신고", "content", "문안 검토·문의 접수", "PARTIAL", "/admin/place-operations", "제안·정정 처리, 법적 문안은 코드 검토로 변경", "문안 버전·검토자·시행일과 문의 처리 연결"),
  control("A34", "메일 도메인", "operations", "지정 발신 도메인 확인", "PARTIAL", null, "보호된 단일 도메인 경로, 전용 관리 화면 없음", "도메인 검증과 실제 발신 성공을 구분해 확인"),
];

export function parseAdminControlArea(value: string | null): AdminControlFilter {
  return ADMIN_CONTROL_AREAS.find((area) => area.id === value)?.id ?? "all";
}
