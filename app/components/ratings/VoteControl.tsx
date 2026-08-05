import { Form, useNavigation } from "react-router";

export function VoteControl({ vote, saved, signedIn, returnTo }: {
  vote: -1 | 1 | null;
  saved: boolean;
  signedIn: boolean;
  returnTo: string;
}) {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  if (!signedIn) {
    return <div className="reaction-signin"><a href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>로그인하고 취향 남기기</a></div>;
  }
  return (
    <div className="reaction-controls">
      <Form method="post" className="vote-control">
        <input type="hidden" name="intent" value="vote" />
        <button name="value" value="1" aria-pressed={vote === 1} disabled={pending}><span aria-hidden>{vote === 1 ? "✓ " : "↑ "}</span>추천</button>
        <button name="value" value="-1" aria-pressed={vote === -1} disabled={pending}><span aria-hidden>{vote === -1 ? "✓ " : "↓ "}</span>비추천</button>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="saved" value={String(!saved)} />
        <button className="save-control" aria-pressed={saved} disabled={pending}>{saved ? "저장됨" : "저장"}</button>
      </Form>
      <p className="reaction-status" aria-live="polite">{pending ? "반영하는 중…" : vote === 1 ? "이곳을 추천했어요." : vote === -1 ? "이곳을 비추천했어요." : "아직 평가하지 않았어요."}</p>
    </div>
  );
}
