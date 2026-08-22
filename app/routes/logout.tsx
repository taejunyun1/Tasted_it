import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { destroyUserSession } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  return redirect("/", { headers: { "Set-Cookie": await destroyUserSession(request) } });
}
export async function loader() { throw new Response("Method not allowed", { status: 405 }); }
