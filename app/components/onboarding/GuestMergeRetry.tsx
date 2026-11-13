import "./guest-choices.css";
import { useFetcher } from "react-router";
export function GuestMergeRetry() {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  if (fetcher.data?.ok) return <p role="status">{fetcher.data.message}</p>;
  return <aside className="shell guest-merge-retry" aria-label="임시 자료 계정 연결">
    <p role="status">아직 계정에 연결하지 못한 임시 저장과 취향이 있습니다. 원본을 유지하고 있으니 다시 연결해 주세요.</p>
    {fetcher.data && !fetcher.data.ok && <p role="alert">{fetcher.data.message}</p>}
    <fetcher.Form method="post" action="/resources/guest-saves"><input type="hidden" name="intent" value="merge" /><button disabled={fetcher.state !== "idle"}>임시 자료 다시 연결</button></fetcher.Form>
  </aside>;
}
