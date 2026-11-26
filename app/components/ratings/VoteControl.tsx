import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Link, useActionData, useFetcher, useFormAction } from "react-router";
import { authEntryHref } from "../../features/auth/login";
import { GuestSaveControl } from "../onboarding/GuestSaveControl";

const NEGATIVE_REASONS = [
  { value: "MENU", label: "메뉴" },
  { value: "DISTANCE", label: "거리" },
  { value: "PRICE", label: "가격" },
  { value: "ATMOSPHERE", label: "분위기" },
  { value: "ALREADY_VISITED", label: "이미 가본 곳" },
] as const;

type Reaction = "recommend" | "dislike" | "withdraw" | "save";
type ReactionSubmission = { intent: Exclude<Reaction, "save"> } | { intent: "save"; targetSaved: boolean };
type ReactionOutcome = { ok: boolean; error?: string; resultUnknown?: boolean; requiresRefresh?: boolean; status?: number };

const pendingMessage: Record<Reaction, string> = {
  recommend: "추천 반영 중…",
  dislike: "비추천 반영 중…",
  withdraw: "평가 취소 중…",
  save: "저장 상태를 바꾸고 있어요.",
};

function outcomeMessage(outcome: ReactionOutcome, submitted: ReactionSubmission) {
  if (outcome.ok) {
    if (submitted.intent === "save") return submitted.targetSaved ? "맛집지도에 추가했어요." : "맛집지도에서 뺐어요.";
    if (submitted.intent === "withdraw") return "평가를 취소했습니다.";
    return submitted.intent === "dislike" ? "비추천을 반영했습니다." : "추천을 반영했습니다.";
  }
  if (outcome.error === "VOTE_VERSION_CONFLICT" || outcome.requiresRefresh || outcome.status === 409) {
    return "다른 요청에서 평가가 변경되었습니다. 현재 상태를 다시 확인해 주세요.";
  }
  if (outcome.resultUnknown) return "처리 결과를 확인하지 못했어요. 다시 요청하기 전에 현재 상태를 확인해 주세요.";
  return "요청을 처리하지 못했어요. 입력을 확인한 뒤 다시 시도해 주세요.";
}

export function VoteControl({ vote, saved, signedIn, returnTo, placeId, voteEventId, action, busyReading = false, onRefresh = () => window.location.reload(), directions, sheetActionsRef }: {
  placeId: string;
  vote: -1 | 1 | null;
  voteEventId?: string | null;
  saved: boolean;
  signedIn: boolean;
  returnTo: string;
  action?: string;
  busyReading?: boolean;
  onRefresh?: () => void;
  directions?: ReactNode;
  sheetActionsRef?: Ref<HTMLDivElement>;
}) {
  const mutation = useFetcher<ReactionOutcome>();
  const actionData = useActionData<ReactionOutcome>();
  const actionPath = useFormAction(action);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const locked = useRef(false);
  const focusFeedback = useRef(false);
  const [submitted, setSubmitted] = useState<ReactionSubmission | null>(null);
  const [pending, setPending] = useState(false);
  const [negativeReasonOpen, setNegativeReasonOpen] = useState(vote === -1);
  const reasonFormId = useId();
  const sheet = Boolean(directions);
  const busy = pending || mutation.state !== "idle";
  const documentFailure = !sheet && actionData?.ok === false ? actionData : null;
  const outcome = busy ? null : mutation.data ?? documentFailure;
  const receipt = submitted ?? (documentFailure ? { intent: "recommend" as const } : null);
  const needsRead = Boolean(outcome && !outcome.ok && (outcome.resultUnknown || outcome.requiresRefresh || outcome.error === "VOTE_VERSION_CONFLICT" || outcome.status === 409));
  const disabled = busy || busyReading || needsRead;

  useEffect(() => {
    if (!outcome || !focusFeedback.current) return;
    focusFeedback.current = false;
    if (document.activeElement === document.body || document.activeElement === feedbackRef.current) {
      feedbackRef.current?.focus({ preventScroll: true });
    }
  }, [outcome]);

  function submit(event: FormEvent<HTMLFormElement>, reaction: Reaction) {
    event.preventDefault();
    if (locked.current || disabled) return;
    const form = new FormData(event.currentTarget);
    if (sheet) form.set("browseReturnTo", returnTo);
    locked.current = true;
    focusFeedback.current = true;
    setSubmitted(reaction === "save" ? { intent: "save", targetSaved: form.get("saved") === "true" } : { intent: reaction });
    setPending(true);
    if (reaction === "recommend" || reaction === "withdraw") setNegativeReasonOpen(false);
    void mutation.submit(form, { method: "post", action: actionPath }).finally(() => {
      locked.current = false;
      setPending(false);
    });
  }

  if (!signedIn) {
    const loginHref = sheet ? authEntryHref("/login", returnTo) : `/login?returnTo=${encodeURIComponent(returnTo)}`;
    const signIn = <div className={sheet ? undefined : "reaction-signin"}>
      <Link className={sheet ? "place-detail-sheet__save" : undefined} to={loginHref}>{sheet ? "로그인하고 맛집지도에 추가" : "로그인하고 취향 남기기"}</Link>
      <GuestSaveControl placeId={placeId} returnTo={returnTo} showLogin={false} />
    </div>;
    return sheet ? <div ref={sheetActionsRef} className="place-detail-sheet__actions">{signIn}{directions}</div> : signIn;
  }

  const saveControl = needsRead && sheet ? null : <mutation.Form method="post" action={action} onSubmit={event => submit(event, "save")}>
    <input type="hidden" name="intent" value="save" />
    <input type="hidden" name="saved" value={String(!saved)} />
    <button className={sheet ? "place-detail-sheet__save" : "save-control"} aria-pressed={saved} disabled={disabled}>
      {busy && submitted?.intent === "save" ? "저장 중…" : sheet ? (saved ? "맛집지도에서 빼기" : "맛집지도에 추가") : (saved ? "저장됨" : "저장")}
    </button>
  </mutation.Form>;
  const refresh = needsRead && <button type="button" className={sheet ? "place-detail-sheet__save" : undefined} onClick={onRefresh}>현재 상태 다시 확인</button>;
  return <>
    <div className="reaction-controls">
      <mutation.Form method="post" action={action} className="vote-control" onSubmit={event => submit(event, "recommend")}>
        <input type="hidden" name="intent" value="vote" />
        <input type="hidden" name="value" value="1" />
        <button type="submit" aria-pressed={vote === 1} disabled={disabled}><span aria-hidden>{vote === 1 ? "✓ " : "↑ "}</span>추천</button>
        <button
          type="button"
          aria-pressed={vote === -1}
          aria-expanded={negativeReasonOpen}
          aria-controls={negativeReasonOpen ? reasonFormId : undefined}
          disabled={disabled}
          onClick={() => setNegativeReasonOpen((open) => !open)}
        ><span aria-hidden>{vote === -1 ? "✓ " : "↓ "}</span>비추천</button>
      </mutation.Form>
      {negativeReasonOpen && (
        <mutation.Form method="post" action={action} id={reasonFormId} className="negative-reason-form" onSubmit={event => submit(event, "dislike")}>
          <input type="hidden" name="intent" value="vote" />
          <input type="hidden" name="value" value="-1" />
          <fieldset disabled={disabled}>
            <legend>비추천 이유를 하나 선택해 주세요</legend>
            {NEGATIVE_REASONS.map((reason) => (
              <label key={reason.value} className="negative-reason-option">
                <input type="radio" name="reason" value={reason.value} required />
                <span>{reason.label}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={disabled}>비추천 반영</button>
        </mutation.Form>
      )}
      {vote !== null && voteEventId && (
        <mutation.Form method="post" action={action} onSubmit={event => submit(event, "withdraw")}>
          <input type="hidden" name="intent" value="withdraw" />
          <input type="hidden" name="expectedEventId" value={voteEventId} />
          <button type="submit" disabled={disabled}>평가 취소</button>
        </mutation.Form>
      )}
      {!sheet && saveControl}
      <p className="reaction-status">
        <span>{vote === 1 ? "이곳을 추천했어요." : vote === -1 ? "이곳을 비추천했어요." : "아직 평가하지 않았어요."}</span>
      </p>
      {receipt && (busy || outcome) && <p id="vote-feedback" ref={feedbackRef} className="w-full text-xs text-[var(--muted)]" role={outcome?.ok === false ? "alert" : "status"} tabIndex={-1}>
        {outcome ? outcomeMessage(outcome, receipt) : pendingMessage[receipt.intent]}
      </p>}
      {!sheet && refresh}
    </div>
    {sheet && <div ref={sheetActionsRef} className="place-detail-sheet__actions">{saveControl}{refresh}{directions}</div>}
  </>;
}
