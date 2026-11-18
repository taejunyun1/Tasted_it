const correctionFieldLimits = {
  placeId: 128, requestType: 32, relation: 4096, email: 320,
  name: 4096, address: 4096, phone: 4096, evidenceNote: 4096,
} as const;

export function retainedCorrectionValues(form: FormData) {
  const values = {} as Record<keyof typeof correctionFieldLimits, string>;
  for (const [name, limit] of Object.entries(correctionFieldLimits)) {
    const raw = form.get(name);
    values[name as keyof typeof correctionFieldLimits] = typeof raw === "string" ? raw.slice(0, limit) : "";
  }
  return values;
}

const suggestionStates: Record<string, { label: string; detail: string }> = {
  SUBMITTED: { label: "접수 완료", detail: "관리자가 제안한 내용을 확인할 예정입니다." },
  NEEDS_INFO: { label: "보완 필요", detail: "아래 검토 의견에서 보완이 필요한 내용을 확인해 주세요." },
  REVIEWING: { label: "검토 중", detail: "제안한 장소와 정보를 확인하고 있습니다." },
  APPROVED: { label: "승인됨", detail: "장소 초안이 만들어졌습니다. 공개 여부는 별도로 검토합니다." },
  REJECTED: { label: "반려됨", detail: "아래 검토 의견에서 반려 사유를 확인해 주세요." },
  DUPLICATE: { label: "중복 확인", detail: "이미 등록되었거나 다른 제안과 겹치는 장소입니다." },
};

export function suggestionState(status: string) {
  return Object.hasOwn(suggestionStates, status) ? suggestionStates[status]! : { label: "상태 확인 필요", detail: "제안의 처리 상태를 확인하고 있습니다." };
}

export function submissionDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { dateTime: undefined, label: "일시 확인 필요" };
  return { dateTime: date.toISOString(), label: `${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date)} KST` };
}
