import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useFetcher } from "react-router";
import type { clientLoader as placeDetailLoader } from "../../routes/place-detail";
import { useDialogFocusTrap } from "../a11y/useDialogFocusTrap";
import { safePlaceDetailRequestPath } from "./PlaceCard";
import { GuestSaveControl } from "../onboarding/GuestSaveControl";
import { TempCatalogNotice } from "../../features/temp-catalog/TempCatalogNotice";
import type { PlaceDetailLoadFailure } from "../../features/places/place-detail-client";
import { formatPublicRatingSummary } from "../../features/places/place-discovery";
import { formatRatingGroup } from "../../features/ratings/public-rating";
import { PublicRatingMeta } from "../ratings/PublicRatingMeta";
import { FlavorMeter } from "../ratings/FlavorMeter";

type DetailData = Awaited<ReturnType<typeof placeDetailLoader>>;
type MutationData = { ok: boolean; error?: string; resultUnknown?: boolean; status?: number };

export function PlaceDetailSheet({ detailPath, slug, onClose }: {
  detailPath?: string | null;
  slug?: string | null;
  onClose: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const requestPath = detailPath === undefined
    ? safePlaceDetailRequestPath(slug ? `/places/${slug}` : null)
    : safePlaceDetailRequestPath(detailPath);
  if (!requestPath) return null;
  // Each request owns its fetchers and receipt. Closing or selecting another
  // place cannot carry an earlier response, save state or failure into it.
  return <PlaceDetailRequest key={`${requestPath}:${attempt}`} requestPath={requestPath} onClose={onClose} onRetry={() => setAttempt((value) => value + 1)} />;
}

function PlaceDetailRequest({ requestPath, onClose, onRetry }: { requestPath: string; onClose: () => void; onRetry: () => void }) {
  const detail = useFetcher<DetailData>();
  const save = useFetcher<MutationData>();
  const sheetRef = useRef<HTMLElement>(null);
  const submissionLock = useRef(false);
  const submissionStarted = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [readFailure, setReadFailure] = useState<PlaceDetailLoadFailure | null>(null);
  const [submission, setSubmission] = useState<{ intent: string; saved: boolean } | null>(null);
  useEffect(() => { void detail.load(requestPath); }, [requestPath, detail.load]);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [requestPath]);
  useEffect(() => {
    if (save.state !== "idle") submissionStarted.current = true;
    else if (submissionStarted.current) {
      submissionLock.current = false;
      submissionStarted.current = false;
      setWaiting(false);
    }
  }, [save.state]);
  useDialogFocusTrap(sheetRef, { active: true, onClose });
  useEffect(() => {
    if (detail.data && "detailError" in detail.data) setReadFailure(detail.data);
  }, [detail.data]);
  // An unrelated route revalidation must not erase the displayed failure.
  // The explicit retry remounts this request and clears the failure receipt.
  const failure = readFailure ?? (detail.data && "detailError" in detail.data ? detail.data : null);
  const data = !failure && detail.data && !("detailError" in detail.data) ? detail.data : null;
  const loading = !data && !failure;
  const busy = waiting || save.state !== "idle";
  const resultUnknown = save.data?.resultUnknown === true;
  const needsRead = save.data?.ok === false;
  const unavailable = failure?.status === 403 || failure?.status === 404;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (submissionLock.current || busy || needsRead || detail.state !== "idle") {
      event.preventDefault();
      return;
    }
    const form = new FormData(event.currentTarget);
    submissionLock.current = true;
    setWaiting(true);
    setSubmission({ intent: String(form.get("intent")), saved: form.get("saved") === "true" });
  };
  return <div className="place-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={sheetRef} className="place-detail-sheet" role="dialog" aria-modal="true" aria-busy={loading || busy} tabIndex={-1} aria-label={data ? `${data.place.name} 상세 정보` : loading ? "장소 상세 불러오는 중" : "장소 상세 오류"}>
      <div className="place-detail-sheet__handle" aria-hidden="true" />
      <button type="button" className="place-detail-sheet__close" aria-label="상세 정보 닫기" onClick={onClose}>×</button>
      {loading ? <p className="place-detail-sheet__loading" role="status">장소 정보를 불러오는 중…</p> : !data ? <div className="place-detail-sheet__body">
        <h2>{failure?.status === 404 ? "이 장소를 찾을 수 없어요." : failure?.status === 403 ? "이 장소를 볼 수 없어요." : "장소 정보를 불러오지 못했어요."}</h2>
        <p role="status">{unavailable ? "공개된 다른 장소를 찾아보세요." : "연결 상태를 확인한 뒤 다시 시도해 주세요."}</p>
        <div className="place-detail-sheet__actions">
          {!unavailable && <button type="button" className="place-detail-sheet__save" onClick={onRetry}>다시 불러오기</button>}
          <button type="button" onClick={onClose}>목록으로 돌아가기</button>
        </div>
      </div> : <>
        <div className="place-detail-sheet__hero" data-has-photo={Boolean(data.place.heroImageUrl)}>{data.place.heroImageUrl ? <img src={data.place.heroImageUrl} alt="" /> : <span>{data.place.primaryCategory.emoji}<br />{data.place.tempCatalog ? "TEMP · 사진 미제공" : "아직 등록된 사진이 없어요."}</span>}</div>
        <div className="place-detail-sheet__body">
          <div className="place-detail-sheet__meta"><p className="eyebrow">{data.place.primaryCategory.emoji} {data.place.primaryCategory.name} · {data.place.neighborhood}</p><span className="place-verified-badge">{data.place.tempCatalog ? "TEMP · 영업 미확인" : "검수 완료"}</span></div>
          <h2>{data.place.name}</h2>
          {data.place.tempCatalog && <TempCatalogNotice info={data.place.tempCatalog} />}
          <address>{data.place.address}</address>
          <div className="place-detail-sheet__score"><div><strong>{data.rating.overallScore !== null ? `${data.rating.overallScore}%` : data.rating.overallSampleCount < 8 ? `${data.rating.overallSampleCount}/8` : `${data.rating.overallSampleCount}명`}</strong><p className="public-rating-summary">{formatPublicRatingSummary(data.place)}</p></div><PublicRatingMeta place={data.place} /></div>
          <div className="place-detail-sheet__breakdown"><span>일반 회원 <b>{formatRatingGroup(data.rating.userScore, data.rating.userSampleCount)}</b></span><span>리뷰어 <b>{formatRatingGroup(data.rating.reviewerScore, data.rating.reviewerSampleCount)}</b></span></div>
          {data.flavorPrint.status === "VISIBLE" && <section><h3>Flavor Print</h3>{data.flavorPrint.dimensions.map((dimension) => <div className="place-detail-sheet__flavor" key={dimension.key}><span>{dimension.key}</span><FlavorMeter dimension={dimension.key} value={dimension.median} /><b>{dimension.median}/5</b></div>)}</section>}
          <dl><div><dt>주소</dt><dd>{data.place.address}</dd></div><div><dt>주차</dt><dd>{data.place.parkingSummary ?? "정보 확인 중"}</dd></div>{data.place.phone && <div><dt>전화</dt><dd>{data.place.phone}</dd></div>}</dl>
          {busy && <p role="status">{submission?.intent === "withdraw" ? "평가를 취소하고 있어요." : "저장 상태를 바꾸고 있어요."}</p>}
          {!busy && submission && save.data?.ok && <p role="status">{submission.intent === "withdraw" ? "평가를 취소했어요." : submission.saved ? "맛집지도에 추가했어요." : "맛집지도에서 뺐어요."}</p>}
          {!busy && save.data?.ok === false && <div role="alert">
            <p>{resultUnknown ? "처리 결과를 확인하지 못했어요. 다시 요청하기 전에 현재 상태를 확인해 주세요." : save.data.error === "VOTE_VERSION_CONFLICT" ? "평가가 변경되었어요. 현재 상태를 다시 확인해 주세요." : "요청을 처리하지 못했어요. 현재 상태를 확인한 뒤 다시 시도해 주세요."}</p>
          </div>}
          <div className="place-detail-sheet__actions">
            {data.user ? needsRead ? <button type="button" className="place-detail-sheet__save" onClick={onRetry}>현재 상태 다시 확인</button> : <save.Form method="post" action={requestPath} onSubmit={submit}><input type="hidden" name="intent" value="save"/><input type="hidden" name="saved" value={String(!data.saved)}/><button className="place-detail-sheet__save" disabled={busy || detail.state !== "idle"} aria-pressed={data.saved}>{busy && submission?.intent === "save" ? "저장 중…" : data.saved ? "맛집지도에서 빼기" : "맛집지도에 추가"}</button></save.Form> : <div><Link className="place-detail-sheet__save" to={`/login?returnTo=${encodeURIComponent(requestPath)}`}>로그인하고 맛집지도에 추가</Link><GuestSaveControl placeId={data.place.id} returnTo={requestPath} showLogin={false}/></div>}
            {data.user && data.voteEventId && <save.Form method="post" action={requestPath} onSubmit={submit}><input type="hidden" name="intent" value="withdraw"/><input type="hidden" name="expectedEventId" value={data.voteEventId}/><button disabled={busy || needsRead || detail.state !== "idle"}>{busy && submission?.intent === "withdraw" ? "취소 중…" : "평가 취소"}</button></save.Form>}
            <a href={`https://map.naver.com/p/search/${encodeURIComponent(data.place.address)}`} target="_blank" rel="noreferrer">네이버 길찾기 ↗</a>
          </div>
        </div>
      </>}
    </aside>
  </div>;
}
