import { type FormEvent, useState } from "react";
import { useFetcher } from "react-router";
import { REVIEWER_BADGE_CATALOG, type ReviewerCategoryName } from "../features/ratings/reviewer-visit";

export type ReviewerVisitStatus = "LEGACY_UNREVIEWED" | "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "WITHDRAWN";
export const reviewerVisitStatusLabels: Record<ReviewerVisitStatus, string> = {
  LEGACY_UNREVIEWED: "기존 자료 · 보완 필요", PENDING: "검수 대기", APPROVED: "승인됨",
  CHANGES_REQUESTED: "보완 요청", REJECTED: "반려", WITHDRAWN: "공개 회수·철회",
};
export type PhotoRights = { photoId: string; position: number; takenOn: string; rightsBasis: "OWN_WORK" | "PERMISSION"; rightsNote: string; caption: string; privacyChecked: boolean };
export type OwnerVisit = {
  id: string; version: number; evaluation: "RECOMMEND" | "HOLD" | "NOT_RECOMMEND";
  categoryId: string; categoryName: string; badgesJson: string;
  isCurrent?: boolean; goldenRequested?: boolean; goldenReason?: string | null; cleanupPending?: boolean;
  status?: ReviewerVisitStatus; reviewReason?: string | null;
  visitedOn?: string | null; visitNote?: string | null; disclosure?: string | null;
  photos: Array<{ id: string; url: string; position?: number; takenOn?: string | null; rightsBasis?: string | null; rightsNote?: string | null; caption?: string | null; privacyChecked?: boolean }>;
};

export function reviewerModerationErrorMessage(code: string) {
  const messages: Record<string, string> = {
    ACTIVE_REVIEWER_REQUIRED: "현재 계정은 새 리뷰를 제출하거나 수정할 수 없어요. 본인 기록의 철회·사진 삭제는 계속할 수 있습니다.",
    PUBLISHED_PLACE_REQUIRED: "장소 공개 상태가 바뀌었어요. 장소 정보를 다시 확인해 주세요.",
    REVIEW_PHOTO_DELETE_PENDING: "사진 삭제가 아직 끝나지 않았어요. 비공개 상태에서 사진 삭제를 다시 확인한 뒤 수정해 주세요.",
    REVIEW_VERSION_CONFLICT: "다른 변경이 먼저 저장됐어요. 새로고침 후 최신 내용을 확인하고 다시 시도해 주세요.",
    REVIEW_MODERATION_CONFLICT: "다른 검수나 수정이 먼저 처리됐어요. 최신 상태를 확인해 주세요.",
    REVIEW_OWNER_REQUIRED: "본인이 작성한 방문 리뷰만 수정할 수 있어요.",
    REVIEW_NOT_FOUND: "변경할 방문 리뷰를 찾지 못했어요.",
    REVIEW_ID_EXISTS: "이미 처리한 요청이에요. 제출 기록을 다시 확인해 주세요.",
    REVIEW_CURRENT_EXISTS: "이 장소에 현재 제출 기록이 있어요. 해당 기록을 수정하거나 철회한 뒤 다른 방문 기록을 보완해 주세요.",
    REVIEW_METADATA_INVALID: "방문일·방문 근거·이해관계와 사진별 권리 정보를 확인해 주세요.",
    REVIEW_BADGE_LIMIT: "맛 배지는 최대 2개까지 선택해 주세요.",
    REVIEW_BADGE_INVALID: "선택한 음식 카테고리의 맛 배지를 다시 확인해 주세요.",
    GOLDEN_PICK_PUBLISHED_PHOTO_REQUIRED: "Golden Pick은 사진 1장과 맛 배지 2개, 15–100자 이유가 필요해요.",
    GOLDEN_PICK_REASON_LENGTH: "Golden Pick 이유를 15–100자로 입력해 주세요.",
    REVIEW_SUBMISSION_INVALID: "필수 입력과 선택 내용을 다시 확인해 주세요.",
    REVIEW_DISCLOSURE_REQUIRED: "이해관계를 확인한 뒤 다시 제출해 주세요.",
    REVIEW_TRANSITION_INVALID: "현재 상태에서는 이 처리를 할 수 없어요. 최신 상태를 확인해 주세요.",
    REVIEW_DISCLOSURE_UNRESOLVED: "이해관계가 없음을 확인하기 전에는 일반 승인으로 공개할 수 없어요.",
    REVIEW_CHECKS_REQUIRED: "방문·권리·개인정보·장소 확인을 모두 마쳐 주세요.",
    REVIEW_APPROVAL_CHECKS_REQUIRED: "방문·권리·개인정보·장소 확인을 모두 마쳐 주세요.",
    REVIEW_VISIT_INVALID: "실제 방문일과 방문 근거·이해관계를 확인해 주세요.",
    REVIEW_PHOTO_RIGHTS_INVALID: "사진별 촬영일·권리 근거·설명과 개인정보 확인을 모두 입력해 주세요.",
    REVIEW_MODERATION_CHECKS_REQUIRED: "방문·권리·개인정보·장소 확인을 모두 마쳐 주세요.",
  };
  return messages[code] ?? "요청을 처리하지 못했어요. 최신 상태와 입력 내용을 확인하고 다시 시도해 주세요.";
}

export function VisitEvidenceFields({ initial = {} }: { initial?: { visitedOn?: string | null; visitNote?: string | null; disclosure?: string | null } }) {
  return <fieldset className="reviewer-evidence-fields"><legend>방문 근거와 이해관계</legend>
    <label><span>방문일</span><input type="date" name="visitedOn" required defaultValue={initial.visitedOn ?? ""} /></label>
    <label><span>직접 확인한 방문 근거</span><textarea name="visitNote" required maxLength={1000} defaultValue={initial.visitNote ?? ""} placeholder="직접 방문해 확인한 음식과 상황을 적어 주세요. 연락처·영수증 개인정보는 적지 마세요." /></label>
    <label><span>광고·협찬·이해관계</span><select name="disclosure" required defaultValue={initial.disclosure ?? ""}>
      <option value="">선택해 주세요</option><option value="NONE">해당 없음</option><option value="DECLARED">광고·협찬 등 이해관계 있음</option><option value="UNKNOWN">확인이 필요함</option>
    </select></label>
    <p>이해관계가 있거나 확인이 필요한 자료는 별도 기준이 정해지기 전 일반 승인으로 공개되지 않아요.</p>
  </fieldset>;
}

export function PhotoRightsFields({ photo, fieldKey, number }: { photo?: OwnerVisit["photos"][number]; fieldKey: string; number: number }) {
  return <fieldset className="reviewer-photo-rights"><legend>사진 {number} 확인</legend>
    <label><span>사진 {number} 촬영일</span><input type="date" name={`takenOn-${fieldKey}`} required defaultValue={photo?.takenOn ?? ""} /></label>
    <label><span>사진 {number} 이용권리</span><select name={`rightsBasis-${fieldKey}`} required defaultValue={photo?.rightsBasis ?? ""}>
      <option value="">선택해 주세요</option><option value="OWN_WORK">직접 촬영</option><option value="PERMISSION">이용허락 받음</option>
    </select></label>
    <label><span>사진 {number} 권리 근거</span><textarea name={`rightsNote-${fieldKey}`} required maxLength={1000} defaultValue={photo?.rightsNote ?? ""} placeholder="직접 촬영한 사실 또는 이용허락의 범위를 설명해 주세요. 개인 연락처·서류 원문은 넣지 마세요." /></label>
    <label><span>사진 {number} 설명</span><input name={`caption-${fieldKey}`} required maxLength={300} defaultValue={photo?.caption ?? ""} /></label>
    <label className="reviewer-check"><input type="checkbox" name={`privacyChecked-${fieldKey}`} required defaultChecked={photo?.privacyChecked === true} /><span>사진 {number}의 불필요한 인물·차량번호·개인정보 노출을 확인했어요.</span></label>
  </fieldset>;
}

export function photoRightsFromForm(form: FormData, fieldKey: string, photoId: string, position = 0): PhotoRights {
  return { photoId, position, takenOn: String(form.get(`takenOn-${fieldKey}`) ?? ""), rightsBasis: String(form.get(`rightsBasis-${fieldKey}`) ?? "") as PhotoRights["rightsBasis"], rightsNote: String(form.get(`rightsNote-${fieldKey}`) ?? ""), caption: String(form.get(`caption-${fieldKey}`) ?? ""), privacyChecked: form.get(`privacyChecked-${fieldKey}`) === "on" };
}

export function OwnerVisitActions({ review, canEdit = true }: { review: OwnerVisit; canEdit?: boolean }) {
  const edit = useFetcher<{ ok: boolean; error?: string }>();
  const withdrawal = useFetcher<{ ok: boolean; error?: string }>();
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [withdrawalVersion, setWithdrawalVersion] = useState<number | null>(null);
  let badges: string[] = [];
  try { const parsed: unknown = JSON.parse(review.badgesJson); if (Array.isArray(parsed)) badges = parsed.filter((value): value is string => typeof value === "string"); } catch { /* 미확인 레거시 배지는 자동으로 선택하지 않는다. */ }
  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (edit.state !== "idle") return;
    setEditVersion(review.version);
    const form = new FormData(event.currentTarget);
    form.set("photoMetadata", JSON.stringify(review.photos.map((photo, index) => photoRightsFromForm(form, photo.id, photo.id, photo.position ?? index))));
    for (const photo of review.photos) for (const key of ["takenOn", "rightsBasis", "rightsNote", "caption", "privacyChecked"]) form.delete(`${key}-${photo.id}`);
    edit.submit(form, { method: "post", action: "/reviewer/ratings" });
  }
  return <div className="reviewer-owner-actions">
    {review.cleanupPending && <p role="status">사진 삭제가 아직 끝나지 않았어요. 비공개 상태를 유지하며 삭제 완료 후 내용을 수정할 수 있습니다.</p>}
    {canEdit && !review.cleanupPending && <details><summary>내용 보완·다시 제출</summary>
      <p>수정하면 이전 승인과 사진 공개가 중단되고 다시 검수해요. 기존 기록은 보존됩니다.</p>
      <edit.Form method="post" action="/reviewer/ratings" onSubmit={submitEdit} aria-label={`방문 리뷰 ${review.id} 수정`}>
        <input type="hidden" name="intent" value="edit-review" /><input type="hidden" name="reviewId" value={review.id} /><input type="hidden" name="expectedVersion" value={review.version} />
        <input type="hidden" name="categoryId" value={review.categoryId} /><input type="hidden" name="categoryName" value={review.categoryName} />
        <label className="reviewer-check"><input type="checkbox" name="golden" value="1" defaultChecked={review.goldenRequested && review.photos.length > 0} disabled={!review.photos.length} /><span>Golden Pick 검수 요청 · 사진 1장과 맛 배지 2개 필요</span></label>
        <label><span>Golden Pick 이유</span><textarea name="goldenReason" maxLength={100} defaultValue={review.goldenReason ?? ""} /></label>
        <fieldset className="reviewer-evidence-fields"><legend>맛 배지 · 최대 2개</legend>{(REVIEWER_BADGE_CATALOG[review.categoryName as ReviewerCategoryName] ?? []).map((badge) => <label className="reviewer-check" key={badge}><input type="checkbox" name="badges" value={badge} defaultChecked={badges.includes(badge)} /><span>{badge}</span></label>)}</fieldset>
        <label><span>평가</span><select name="evaluation" defaultValue={review.evaluation}><option value="RECOMMEND">추천</option><option value="HOLD">보류</option><option value="NOT_RECOMMEND">비추천</option></select></label>
        <VisitEvidenceFields initial={review} />
        {review.photos.map((photo, index) => <div key={photo.id}><img src={photo.url} alt={`현재 사진 ${index + 1} 미리보기`} width="180" height="140" /><PhotoRightsFields photo={photo} fieldKey={photo.id} number={index + 1} /></div>)}
        <label><span>수정 사유</span><input name="reason" required maxLength={500} /></label>
        {edit.data?.ok === false && editVersion === review.version && <p role="alert">{reviewerModerationErrorMessage(edit.data.error ?? "")}</p>}
        <button disabled={edit.state !== "idle"}>{edit.state !== "idle" ? "저장 중…" : "수정하고 검수 요청"}</button>
      </edit.Form>
    </details>}
    {(review.status !== "WITHDRAWN" || review.cleanupPending || review.photos.length > 0 || review.isCurrent) && <withdrawal.Form method="post" action="/reviewer/ratings" onSubmit={() => setWithdrawalVersion(review.version)} aria-label={`방문 리뷰 ${review.id} 철회`}>
      <input type="hidden" name="intent" value="withdraw-review" /><input type="hidden" name="reviewId" value={review.id} /><input type="hidden" name="expectedVersion" value={review.version} />
      <p>철회하면 공개를 중단하고 첨부 사진 파일을 삭제해요. 리뷰 내용과 처리 이력은 보존됩니다. 사진 삭제가 끝나지 않으면 비공개 상태에서 다시 시도해 주세요.</p>
      <label><span>철회 사유</span><input name="reason" required maxLength={500} /></label>
      <label className="reviewer-check"><input type="checkbox" required /><span>공개 중단과 사진 삭제를 확인했어요.</span></label>
      {withdrawal.data?.ok === false && withdrawalVersion === review.version && <p role="alert">{reviewerModerationErrorMessage(withdrawal.data.error ?? "")}</p>}
      <button disabled={withdrawal.state !== "idle"}>{withdrawal.state !== "idle" ? "철회 중…" : review.status === "WITHDRAWN" ? review.cleanupPending ? "사진 삭제 다시 확인" : "사진 삭제 요청" : "리뷰 철회·사진 삭제"}</button>
    </withdrawal.Form>}
  </div>;
}
