import type { Route } from "./+types/admin-places";
import { requireAdmin } from "../features/auth/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAdmin(request);
  return { user };
}

export default function AdminPlaces({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <p className="text-sm text-neutral-600">{loaderData.user.email}</p>
      <h1 className="mt-2 text-3xl font-semibold">장소 관리</h1>
      <p className="mt-6">장소 목록과 CSV 가져오기는 다음 작업에서 연결합니다.</p>
    </main>
  );
}
