import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { destroyUserSession } from "../features/auth/session.server";
export async function action({ request }: Route.ActionArgs) { return redirect("/", { headers: { "Set-Cookie": await destroyUserSession(request) } }); }
export async function loader() { throw new Response("Method not allowed", { status: 405 }); }
