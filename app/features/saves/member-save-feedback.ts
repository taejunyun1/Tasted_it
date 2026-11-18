export type MemberSaveResult = {
  kind: "member-save";
  placeId: string;
  message: string;
} & ({ ok: true; outcome: "REMOVED" } | { ok: false; outcome: "REJECTED" | "UNKNOWN" });

export function unknownMemberSave(placeId: string): MemberSaveResult {
  return {
    kind: "member-save", ok: false, outcome: "UNKNOWN", placeId,
    message: "저장 상태를 확인하지 못했습니다. 현재 목록을 다시 확인한 뒤 필요한 경우 다시 시도해 주세요.",
  };
}
