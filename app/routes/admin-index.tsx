import { redirect } from "react-router";

import type { Route } from "./+types/admin-index";
import { requireAdmin } from "../features/auth/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  throw redirect("/admin/place-operations");
}

export default function AdminIndex() {
  return null;
}
