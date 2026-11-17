import privacySource from "../../routes/privacy.tsx?raw";
import termsSource from "../../routes/terms.tsx?raw";

export async function readPolicyVersions() {
  return Promise.all([
    { id: "privacy", title: "개인정보 처리방침", href: "/privacy", source: privacySource },
    { id: "terms", title: "이용약관", href: "/terms", source: termsSource },
  ].map(async ({ source, ...document }) => {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
    return { ...document, sourceHash: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      status: source.includes("출시 전 검토본") ? "출시 전 검토본" : "원문 확인 필요",
      effectiveDate: null,
    };
  }));
}

// Committed review checklist from #360; this is not a declaration of legal facts.
export const UNRESOLVED_POLICY_FACTS = [
  "실제 운영주체와 개인정보 보호책임자·문의처",
  "보유기간·법정 보존 및 별도 삭제 요청의 처리 범위",
  "위탁·국외 이전의 계약 주체·국가·시점·방법·기간",
  "실제 콘텐츠 이용권리와 실증 참여·동의",
  "지원환경·운영 복원 및 인계 수용 증거",
] as const;
