import { redirect } from "react-router";

import type { Route } from "./+types/admin-candidates";
import { requireAdmin } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";

function pipelineHref(request: Request) {
  const current = new URL(request.url);
  const next = new URLSearchParams({ step: "1" });
  for (const key of ["q", "region", "pageSize"]) {
    const value = current.searchParams.get(key);
    if (value) next.set(key, value);
  }
  return `/admin/place-operations?${next}`;
}

/** Legacy candidate review no longer offers an approval bypass. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  throw redirect(pipelineHref(request));
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  await requireAdmin(request);
  throw redirect(pipelineHref(request));
}

export default function AdminCandidates() { return null; }
