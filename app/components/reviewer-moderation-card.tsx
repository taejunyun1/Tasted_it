import { useFetcher } from "react-router";
import { reviewerModerationErrorMessage, reviewerVisitStatusLabels, type OwnerVisit } from "./reviewer-visit-moderation";

export type ModerationQueueVisit = OwnerVisit & {
  placeName: string; placeSlug: string; reviewerDisplayName: string;
};

export function ReviewerModerationCard({ review, retry }: { review: ModerationQueueVisit; retry?: unknown }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const status = review.status ?? "LEGACY_UNREVIEWED";
  const canApprove = status === "PENDING" && !review.cleanupPending;
  const retryReason = retry && typeof retry === "object" && "reviewId" in retry && retry.reviewId === review.id
    && "expectedVersion" in retry && retry.expectedVersion === review.version
    && "reason" in retry && typeof retry.reason === "string" && retry.reason.length > 0 && retry.reason.length <= 500 ? retry.reason : "";
  return <article className="reviewer-moderation-card" id={`moderation-${review.id}`}>
    <header><h2>{review.placeName}</h2><span className="reviewer-moderation-status">{reviewerVisitStatusLabels[status]}</span></header>
    <dl>
      <div><dt>작성자</dt><dd>{review.reviewerDisplayName}</dd></div>
      <div><dt>현재 버전</dt><dd>{review.version}</dd></div>
      <div><dt>방문일</dt><dd>{review.visitedOn ?? "미확인"}</dd></div>
      <div><dt>방문 근거</dt><dd>{review.visitNote || "미확인"}</dd></div>
      <div><dt>이해관계</dt><dd>{review.disclosure === "NONE" ? "해당 없음" : review.disclosure === "DECLARED" ? "이해관계 있음 · 일반 승인 불가" : "미확인 · 일반 승인 불가"}</dd></div>
      <div><dt>평가</dt><dd>{review.evaluation === "RECOMMEND" ? "추천" : review.evaluation === "HOLD" ? "보류" : "비추천"} · {review.categoryName}</dd></div>
      {review.reviewReason && <div><dt>이전 검수 사유</dt><dd>{review.reviewReason}</dd></div>}
    </dl>
    <div className="reviewer-moderation-photos">{review.photos.map((photo) => <figure key={photo.id}>
      <img src={photo.url} alt={photo.caption || "검수 대상 사진"} loading="lazy" />
      <figcaption>{photo.caption || "설명 미확인"}<br />촬영일: {photo.takenOn ?? "미확인"}<br />권리: {photo.rightsBasis === "OWN_WORK" ? "직접 촬영" : photo.rightsBasis === "PERMISSION" ? "이용허락" : "미확인"}<br />근거: {photo.rightsNote || "미확인"}<br />작성자 노출 확인: {photo.privacyChecked ? "확인함" : "미확인"}</figcaption>
    </figure>)}</div>
    {status !== "PENDING" && status !== "APPROVED" && <p>이 상태는 작성자가 내용을 보완해 다시 제출한 뒤 검수할 수 있어요.</p>}
    <p>작성자의 확인은 관리자 검수를 대신하지 않아요. 관리자 회수·보완·반려는 공개를 중단하고 원문과 사진을 보존합니다.</p>
    <fetcher.Form method="post" aria-label={`${review.placeName} 방문 검수`}>
      <input type="hidden" name="reviewId" value={review.id} /><input type="hidden" name="expectedVersion" value={review.version} />
      <fieldset className="reviewer-evidence-fields"><legend>관리자 확인</legend>
        {([
          ["visitVerified", "실제 방문 근거와 사실·의견 구분을 확인했어요."],
          ["rightsVerified", "사진별 촬영일·이용권리·설명을 확인했어요."],
          ["privacyVerified", "불필요한 개인정보 노출을 확인했어요."],
          ["placeVerified", "사진·방문 자료와 대상 장소의 일치를 확인했어요."],
        ] as const).map(([name, label]) => <label className="reviewer-check" key={name}><input name={name} type="checkbox" /><span>{label}</span></label>)}
      </fieldset>
      <label><span>검수 사유</span><textarea name="reason" required maxLength={500} defaultValue={retryReason} placeholder="확인 근거와 승인·보완·반려·회수 사유를 남겨 주세요." /></label>
      {fetcher.data?.ok === false && <p role="alert">{reviewerModerationErrorMessage(fetcher.data.error ?? "")}</p>}
      {fetcher.data?.ok === true && <p role="status">검수 결과를 저장했어요.</p>}
      <div className="reviewer-moderation-buttons">
        <button name="status" value="APPROVED" disabled={!canApprove || fetcher.state !== "idle" || review.disclosure !== "NONE"}>승인·공개</button>
        <button name="status" value="CHANGES_REQUESTED" disabled={fetcher.state !== "idle" || status !== "PENDING"}>보완 요청</button>
        <button name="status" value="REJECTED" disabled={fetcher.state !== "idle" || status !== "PENDING"}>반려</button>
        <button name="status" value="WITHDRAWN" disabled={fetcher.state !== "idle" || (status !== "PENDING" && status !== "APPROVED")}>공개 회수</button>
      </div>
    </fetcher.Form>
  </article>;
}
