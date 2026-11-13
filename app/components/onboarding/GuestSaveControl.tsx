import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { safeReturnTo } from "../../features/auth/login";

type GuestSaveResult = { ok: boolean; saved?: boolean; signedIn?: boolean; expired?: boolean; message?: string };
export function GuestSaveControl({ placeId, returnTo }: { placeId: string; returnTo: string }) {
  const fetcher = useFetcher<GuestSaveResult>();
  useEffect(() => { void fetcher.load(`/resources/guest-saves?placeId=${encodeURIComponent(placeId)}`); }, [placeId]);
  const [saved, setSaved] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (fetcher.data?.ok) {
      setSaved(Boolean(fetcher.data.saved));
      setSignedIn(Boolean(fetcher.data.signedIn));
    }
  }, [fetcher.data]);
  return <div className="guest-save-control">
    <fetcher.Form method="post" action="/resources/guest-saves">
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="placeId" value={placeId} />
      <input type="hidden" name="saved" value={String(!saved)} />
      <button type="submit" aria-pressed={saved} disabled={fetcher.state !== "idle"}>{signedIn ? (saved ? "저장 해제" : "저장") : (saved ? "임시 저장 해제" : "임시 저장")}</button>
    </fetcher.Form>
    {!signedIn && <p>임시 저장은 최대 50곳이며 비회원 취향과 함께 최대 30일 동안 보관합니다.</p>}
    {fetcher.data?.expired && <p role="status">이전 임시 자료가 만료되었습니다. 새로 저장할 수 있어요.</p>}
    {fetcher.data?.ok === false && <p role="alert">{fetcher.data.message}</p>}
    {!signedIn && <a href={`/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`}>로그인하고 임시 자료 연결</a>}
  </div>;
}
