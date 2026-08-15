import { redirect } from "react-router";

import type { Route } from "./+types/admin-candidates-bulk";
import { requireAdmin } from "../features/auth/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  throw redirect("/admin/place-operations?step=1");
}

export default function AdminCandidatesBulk() { return null; }
