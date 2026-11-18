import { useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigation, useRevalidator, useRouteLoaderData } from "react-router";
import { isMapReadFailure, mapReadPath, mapReadStatus, reconcileMapRead, type MapReadFailure, type MapReadSnapshot } from "../../features/maps/map-read-recovery";
import { authEntryHref } from "../../features/auth/login";

export function useMapViewerKey() {
  const root = useRouteLoaderData<{ mapViewerKey: string }>("root");
  return root?.mapViewerKey ?? "unconfirmed";
}

export function MapReadBoundary<T extends object>({ incoming, scope, allowIncoming = true, children }: {
  incoming: T | MapReadFailure; scope: string; allowIncoming?: boolean;
  children: (data: T, failed: boolean) => ReactNode;
}) {
  const location = useLocation(), revalidator = useRevalidator(), navigation = useNavigation();
  const previous = useRef<MapReadSnapshot<T> | null>(null);
  const state = reconcileMapRead(previous.current, incoming, `${scope}:${location.pathname}`, mapReadPath(`${location.pathname}${location.search}`), allowIncoming);
  previous.current = state.snapshot;
  const pending = revalidator.state !== "idle" || navigation.state !== "idle";
  if (!state.data) return <MapReadError status={isMapReadFailure(incoming) ? incoming.status : 503} viewerChanged={!allowIncoming} />;
  return <>
    {state.failed ? <div className="shell border border-current p-4" role="status">
      <p>지도를 새로 불러오지 못했어요. 마지막으로 확인한 결과를 표시합니다. 요청한 검색 조건은 주소에 남아 있습니다.</p>
      <button type="button" className="min-h-11 border border-current px-4" disabled={pending} onClick={() => void revalidator.revalidate()}>{pending ? "지도 다시 불러오는 중…" : "지도 다시 불러오기"}</button>
    </div> : pending && <p className="shell" role="status">지도 정보를 불러오는 중…</p>}
    <fieldset className="contents" disabled={state.failed}>{children(state.data, state.failed)}</fieldset>
  </>;
}

export function MapReadError({ error, status = mapReadStatus(error), viewerChanged = false }: { error?: unknown; status?: number; viewerChanged?: boolean }) {
  const location = useLocation();
  const denied = status === 401 || status === 403 || status === 404;
  return <main id="main" className="error-page">
    <h1>{viewerChanged ? "로그인 상태가 변경되었습니다." : status === 401 ? "로그인이 필요합니다." : status === 403 ? "이 지도를 볼 권한이 없습니다." : status === 404 ? "이 지도를 찾을 수 없습니다." : "지도 정보를 불러오지 못했어요."}</h1>
    <p role="status">{viewerChanged ? "이전 개인화 화면을 닫았습니다. 지도를 다시 불러와 주세요." : denied ? "접근 권한과 주소를 확인해 주세요." : "검색 조건은 주소에 남겨 두었습니다. 연결을 확인한 뒤 다시 시도해 주세요."}</p>
    {!denied && <button type="button" className="min-h-11 border border-current px-4" onClick={() => window.location.reload()}>지도 다시 불러오기</button>}
    {status === 401 && <Link to={authEntryHref("/login", location.pathname, location.search)}>로그인</Link>}
    <Link to="/places">맛집 리스트로</Link>
  </main>;
}
