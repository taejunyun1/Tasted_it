import { env } from "cloudflare:workers";
import { data, Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/reset-password";
import { createDb } from "../db/client.server";
import { resetPassword } from "../features/auth/account.server";
import { AuthInput, AuthPage } from "./login";
export async function action({ request }: Route.ActionArgs) { const form = await request.formData(); try { await resetPassword(createDb(env.DB), { token: String(form.get("token") ?? ""), password: String(form.get("password") ?? ""), now: new Date() }); return { ok: true, message: "새 비밀번호가 저장되었습니다." }; } catch { return data({ ok: false, message: "링크가 만료되었거나 비밀번호가 10자 미만입니다." }, { status: 400 }); } }
export default function Reset({ actionData }: Route.ComponentProps) { const [params] = useSearchParams(); return <AuthPage eyebrow="NEW PASSWORD" title="새 비밀번호 설정" description="이 링크는 한 번만 사용할 수 있습니다.">{actionData?.ok ? <p className="mt-8"><Link className="underline" to="/login">로그인하기</Link></p> : <Form method="post" className="mt-10 grid gap-5"><input type="hidden" name="token" value={params.get("token") ?? ""} /><AuthInput label="새 비밀번호 · 10자 이상" name="password" type="password" autoComplete="new-password" />{actionData?.message && <p className="text-sm text-red-700">{actionData.message}</p>}<button className="bg-neutral-950 px-5 py-3 font-semibold text-white">비밀번호 저장</button></Form>}</AuthPage>; }
