import { useState } from "react";
import { Form, useNavigation } from "react-router";

const NEGATIVE_REASONS = [
  { value: "MENU", label: "메뉴" },
  { value: "DISTANCE", label: "거리" },
  { value: "PRICE", label: "가격" },
  { value: "ATMOSPHERE", label: "분위기" },
  { value: "ALREADY_VISITED", label: "이미 가본 곳" },
] as const;

export function VoteControl({ vote, saved, signedIn, returnTo }: {
  vote: -1 | 1 | null;
  saved: boolean;
  signedIn: boolean;
  returnTo: string;
}) {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  const [negativeReasonOpen, setNegativeReasonOpen] = useState(vote === -1);
  if (!signedIn) {
    return <div className="reaction-signin"><a href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>로그인하고 취향 남기기</a></div>;
  }
  return (
    <div className="reaction-controls">
      <Form method="post" className="vote-control">
        <input type="hidden" name="intent" value="vote" />
        <button name="value" value="1" aria-pressed={vote === 1} disabled={pending} onClick={() => setNegativeReasonOpen(false)}><span aria-hidden>{vote === 1 ? "✓ " : "↑ "}</span>추천</button>
        <button
          type="button"
          aria-pressed={vote === -1}
          aria-expanded={negativeReasonOpen}
          aria-controls="negative-reason-form"
          disabled={pending}
          onClick={() => setNegativeReasonOpen((open) => !open)}
        ><span aria-hidden>{vote === -1 ? "✓ " : "↓ "}</span>비추천</button>
      </Form>
      {negativeReasonOpen && (
        <Form method="post" id="negative-reason-form" className="negative-reason-form">
          <input type="hidden" name="intent" value="vote" />
          <input type="hidden" name="value" value="-1" />
          <fieldset disabled={pending}>
            <legend>비추천 이유를 하나 선택해 주세요</legend>
            {NEGATIVE_REASONS.map((reason) => (
              <label key={reason.value} className="negative-reason-option">
                <input type="radio" name="reason" value={reason.value} required />
                <span>{reason.label}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={pending}>비추천 반영</button>
        </Form>
      )}
      <Form method="post">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="saved" value={String(!saved)} />
        <button className="save-control" aria-pressed={saved} disabled={pending}>{saved ? "저장됨" : "저장"}</button>
      </Form>
      <p className="reaction-status" aria-live="polite">{pending ? "반영하는 중…" : vote === 1 ? "이곳을 추천했어요." : vote === -1 ? "이곳을 비추천했어요." : "아직 평가하지 않았어요."}</p>
    </div>
  );
}
