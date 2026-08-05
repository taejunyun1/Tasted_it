import { env } from "cloudflare:workers";
import { Link } from "react-router";

import type { Route } from "./+types/admin-places";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { listAdminPlaces } from "../features/places/place.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAdmin(request);
  const places = await listAdminPlaces(createDb(env.DB));
  return { user, places };
}

export default function AdminPlaces({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-300 pb-6">
        <div>
          <p className="text-sm text-neutral-600">{loaderData.user.email}</p>
          <h1 className="mt-2 text-3xl font-semibold">장소 관리</h1>
        </div>
        <nav className="flex gap-3">
          <Link className="border border-neutral-950 px-4 py-2 font-medium" to="/admin/candidates">후보 검수</Link>
          <Link className="border border-neutral-950 px-4 py-2 font-medium" to="/admin/import">CSV 가져오기</Link>
        </nav>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full border-collapse text-left">
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
                <td className="px-2 py-4 font-medium">{place.name}</td>
                <td className="px-2 py-4">{place.categoryName}</td>
                <td className="px-2 py-4 text-sm text-neutral-600">
                  {place.updatedAt}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
