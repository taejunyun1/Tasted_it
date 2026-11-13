import "./guest-choices.css";
import { useFetcher } from "react-router";
export function GuestMergeRetry() {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  if (fetcher.data?.ok) return <p role="status">{fetcher.data.message}</p>;
  return <aside className="shell guest-merge-retry" aria-label="임시 자료 계정 연결">
    <p role="status">임시 저장과 취향의 계정 연결 상태를 확인해 주세요. 새로고침한 뒤 연결이 필요한 자료가 있으면 다시 연결할 수 있습니다.</p>
    {fetcher.data && !fetcher.data.ok && <p role="alert">{fetcher.data.message}</p>}
    <fetcher.Form method="post" action="/resources/guest-saves"><input type="hidden" name="intent" value="merge" /><button disabled={fetcher.state !== "idle"}>임시 자료 다시 연결</button></fetcher.Form>
  </aside>;
}
