import { env } from "cloudflare:workers";
import { data, isRouteErrorResponse, Link } from "react-router";

import type { Route } from "./+types/admin-places";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { listAdminPlaces } from "../features/places/place.server";

const PRIVATE = {"Cache-Control":"private, no-store",Vary:"Cookie"};
export const headers=()=>PRIVATE;
export const meta=()=>[{title:"장소 관리 — Re:Taste Admin"},{name:"robots",content:"noindex,nofollow"}];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const places = await listAdminPlaces(createDb(env.DB));
  return data({ places }, {headers:PRIVATE});
}

export default function AdminPlaces({ loaderData }: Route.ComponentProps) {
  return (
    <main id="main" className="admin-page admin-page-frame mx-auto max-w-6xl px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-300 pb-6">
        <div>
          <h1 className="mt-2 text-[21px] font-semibold">장소 관리</h1>
        </div>
        <nav className="flex flex-wrap gap-3">
          <Link className="border border-neutral-950 px-4 py-2 font-medium" to="/admin/place-operations?step=1">장소 검수</Link>
          <Link className="border border-neutral-950 px-4 py-2 font-medium" to="/admin/import">CSV 가져오기</Link>
          <Link className="border border-neutral-950 px-4 py-2 font-medium" to="/admin/poi-media">장소 사진 관리</Link>
        </nav>
      </div>

      {loaderData.places.length ? (
        <div className="mt-8 overflow-x-auto" role="region" aria-label="장소 목록 가로 스크롤" tabIndex={0}>
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="mb-3 text-left">등록된 장소 목록 · 총 {loaderData.places.length}곳</caption>
            <thead>
              <tr className="border-b border-neutral-950 text-sm">
                <th className="px-2 py-3">상태</th>
                <th className="px-2 py-3">장소</th>
                <th className="px-2 py-3">카테고리</th>
                <th className="px-2 py-3">수정 시각</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.places.map((place) => (
                <tr className="border-b border-neutral-200" key={place.id}>
                  <td className="px-2 py-4 text-sm">{place.status}</td>
                  <td className="px-2 py-4 font-medium"><Link to={`/admin/place-operations?place=${encodeURIComponent(place.id)}`}>{place.name}</Link><br/><small>{place.id}</small></td>
                  <td className="px-2 py-4">{place.categoryName}</td>
                  <td className="px-2 py-4 text-sm text-neutral-600">
                    {place.updatedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-8">등록된 장소가 없습니다. 장소 검수 또는 CSV 가져오기에서 추가해 주세요.</p>
      )}
    </main>
  );
}

export function ErrorBoundary({error}:Route.ErrorBoundaryProps) {
  const status=isRouteErrorResponse(error)?error.status:503;
  return <main id="main" className="admin-page"><h1 className="text-[25.2px] md:text-[33.6px]">{status===403?"관리자만 조회할 수 있습니다.":"장소 목록을 열 수 없습니다."}</h1><Link to="/admin/places">다시 조회</Link></main>;
}
