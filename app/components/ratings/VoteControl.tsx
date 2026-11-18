import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { GuestSaveControl } from "../onboarding/GuestSaveControl";

const NEGATIVE_REASONS = [
  { value: "MENU", label: "메뉴" },
  { value: "DISTANCE", label: "거리" },
  { value: "PRICE", label: "가격" },
  { value: "ATMOSPHERE", label: "분위기" },
  { value: "ALREADY_VISITED", label: "이미 가본 곳" },
] as const;

type VoteOutcome = {
  intent: "vote" | "withdraw";
  ok: boolean;
  value?: -1 | 1;
  error?: string;
  resultUnknown?: boolean;
  requiresRefresh?: boolean;
};

function isVoteOutcome(value: unknown): value is VoteOutcome {
  return Boolean(value && typeof value === "object" && "intent" in value
    && (value.intent === "vote" || value.intent === "withdraw") && "ok" in value && typeof value.ok === "boolean");
}

function outcomeMessage(outcome: VoteOutcome) {
  if (outcome.ok) {
    if (outcome.intent === "withdraw") return "평가를 취소했습니다.";
    return outcome.value === -1 ? "비추천을 반영했습니다." : "추천을 반영했습니다.";
  }
  if (outcome.error === "VOTE_VERSION_CONFLICT") return "다른 요청에서 평가가 변경되었습니다. 현재 상태를 다시 확인해 주세요.";
  if (outcome.resultUnknown) return "평가 처리 결과를 확인해야 합니다. 현재 상태 다시 확인을 눌러 주세요.";
  return "평가를 처리하지 못했습니다. 입력을 확인한 뒤 다시 시도해 주세요.";
}

export function VoteControl({ vote, saved, signedIn, returnTo, placeId, voteEventId }: {
  placeId: string;
  vote: -1 | 1 | null;
  voteEventId?: string | null;
  saved: boolean;
  signedIn: boolean;
  returnTo: string;
}) {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  const actionData = useActionData();
  const outcome = isVoteOutcome(actionData) ? actionData : null;
  const requiresRead = Boolean(outcome && !outcome.ok && (outcome.resultUnknown || outcome.requiresRefresh));
  const locked = useRef(false);
  const wasPending = useRef(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [submitted, setSubmitted] = useState<"vote" | "withdraw" | null>(null);
  const [negativeReasonOpen, setNegativeReasonOpen] = useState(vote === -1);
  useEffect(() => {
    if (pending) { if (locked.current) wasPending.current = true; return; }
    if (wasPending.current) {
      wasPending.current = false;
      locked.current = false;
      setSubmitted(null);
      if (outcome) feedbackRef.current?.focus();
    }
  }, [pending, outcome]);
  function submit(event: FormEvent<HTMLFormElement>, intent: "vote" | "withdraw") {
    if (locked.current || pending || requiresRead) { event.preventDefault(); return; }
    locked.current = true;
    setSubmitted(intent);
  }
  const votePending = pending && (submitted !== null || navigation.formData?.get("intent") === "vote" || navigation.formData?.get("intent") === "withdraw");
  const disabled = pending || requiresRead;
  let message = vote === 1 ? "이곳을 추천했어요." : vote === -1 ? "이곳을 비추천했어요." : "아직 평가하지 않았어요.";
  if (outcome) message = outcomeMessage(outcome);
  if (votePending) {
    message = submitted === "withdraw" || navigation.formData?.get("intent") === "withdraw"
      ? "평가 취소 중…" : navigation.formData?.get("value") === "-1" ? "비추천 반영 중…" : "추천 반영 중…";
  }
  if (!signedIn) {
    return <div className="reaction-signin"><a href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>로그인하고 취향 남기기</a><GuestSaveControl placeId={placeId} returnTo={returnTo} showLogin={false}/></div>;
  }
  return (
    <div className="reaction-controls" aria-busy={votePending}>
      <Form method="post" className="vote-control" onSubmit={event => submit(event, "vote")}>
        <input type="hidden" name="intent" value="vote" />
        <button name="value" value="1" aria-pressed={vote === 1} disabled={disabled} onClick={() => setNegativeReasonOpen(false)}><span aria-hidden>{vote === 1 ? "✓ " : "↑ "}</span>추천</button>
        <button
          type="button"
          aria-pressed={vote === -1}
          aria-expanded={negativeReasonOpen}
          aria-controls="negative-reason-form"
          disabled={disabled}
          onClick={() => setNegativeReasonOpen((open) => !open)}
        ><span aria-hidden>{vote === -1 ? "✓ " : "↓ "}</span>비추천</button>
      </Form>
      {negativeReasonOpen && (
        <Form method="post" id="negative-reason-form" className="negative-reason-form" onSubmit={event => submit(event, "vote")}>
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
        </Form>
      )}
      {vote !== null && voteEventId && (
        <Form method="post" onSubmit={event => { submit(event, "withdraw"); if (!event.defaultPrevented) setNegativeReasonOpen(false); }}>
          <input type="hidden" name="intent" value="withdraw" />
          <input type="hidden" name="expectedEventId" value={voteEventId} />
          <button type="submit" disabled={disabled}>평가 취소</button>
        </Form>
      )}
      <Form method="post">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="saved" value={String(!saved)} />
        <button className="save-control" aria-pressed={saved} disabled={disabled}>{saved ? "저장됨" : "저장"}</button>
      </Form>
      <p className="reaction-status">
        <span>{vote === 1 ? "이곳을 추천했어요." : vote === -1 ? "이곳을 비추천했어요." : "아직 평가하지 않았어요."}</span>
      </p>
      {(outcome || votePending) && <p id="vote-feedback" ref={feedbackRef} className="w-full text-xs text-[var(--muted)]" role="status" aria-live="polite" tabIndex={-1}>{message}</p>}
    </div>
  );
}
