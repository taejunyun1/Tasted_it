import { env } from "cloudflare:workers";
import { Link } from "react-router";
import type { Route } from "./+types/verify-email";
import { createDb } from "../db/client.server";
import { verifyEmailToken } from "../features/auth/account.server";
export async function loader({ request }: Route.LoaderArgs) { const token = new URL(request.url).searchParams.get("token") ?? ""; try { await verifyEmailToken(createDb(env.DB), { token, now: new Date() }); return { ok: true }; } catch { return { ok: false }; } }
export default function VerifyEmail({ loaderData }: Route.ComponentProps) { return <main id="main" className="mx-auto min-h-screen max-w-xl px-6 py-20"><h1 className="text-4xl font-semibold">{loaderData.ok ? "이메일 인증 완료" : "인증 링크를 사용할 수 없습니다"}</h1><p className="mt-4 text-neutral-600">{loaderData.ok ? "이제 로그인하고 취향을 기록할 수 있습니다." : "링크가 만료되었거나 이미 사용되었습니다."}</p><Link className="mt-8 inline-block bg-neutral-950 px-5 py-3 text-white" to="/login">로그인으로</Link></main>; }
