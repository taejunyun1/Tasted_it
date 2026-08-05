import { redirect } from "react-router";

import type { Route } from "./+types/admin-candidates-bulk";
import { requireAdmin } from "../features/auth/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return redirect("/admin/candidates");
}

export default function AdminCandidatesBulk() {
  return null;
}
