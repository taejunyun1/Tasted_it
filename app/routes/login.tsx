import { env } from "cloudflare:workers";
import { data, Form, redirect, useSearchParams } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/login";
import { createDb } from "../db/client.server";
import { upsertBetaUser } from "../features/auth/login.server";
import { safeReturnTo } from "../features/auth/login";
import { createUserSession } from "../features/auth/session.server";

const loginSchema = z.object({
  email: z.email("올바른 이메일 주소를 입력해 주세요."),
  displayName: z.string().trim().min(2, "이름은 두 글자 이상 입력해 주세요.").max(40),
  returnTo: z.string().optional(),
});

export function meta() {
  return [{ title: "로그인 — Re:Taste" }];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return data(
      { errors: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  const now = new Date();
  const user = await upsertBetaUser(createDb(env.DB), {
    email: parsed.data.email,
    displayName: parsed.data.displayName,
    adminEmail: env.ADMIN_EMAIL,
    now: now.toISOString(),
    userId: crypto.randomUUID(),
  });
  const cookie = await createUserSession({
    userId: user.id,
    now,
    requestUrl: request.url,
  });

  return redirect(safeReturnTo(parsed.data.returnTo), {
    headers: { "Set-Cookie": cookie },
  });
}

export default function Login({ actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();

  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-20">
      <p className="mb-4 text-sm font-semibold tracking-[0.2em]">RE:TASTE BETA</p>
      <h1 className="text-4xl font-semibold">취향을 남기고 다시 찾기</h1>
      <p className="mt-4 text-neutral-600">
        베타 기간에는 이메일과 표시 이름으로 로그인합니다.
      </p>

      <Form method="post" action="/login" className="mt-10 grid gap-6">
        <input
          type="hidden"
          name="returnTo"
          value={safeReturnTo(searchParams.get("returnTo"))}
        />
        <label className="grid gap-2">
          <span className="font-medium">이메일</span>
          <input
            className="border border-neutral-300 bg-white px-4 py-3"
            type="email"
            name="email"
            autoComplete="email"
            required
          />
          {actionData?.errors.email?.[0] ? (
            <span className="text-sm text-red-700">{actionData.errors.email[0]}</span>
          ) : null}
        </label>
        <label className="grid gap-2">
          <span className="font-medium">표시 이름</span>
          <input
            className="border border-neutral-300 bg-white px-4 py-3"
            type="text"
            name="displayName"
            autoComplete="name"
            minLength={2}
            maxLength={40}
            required
          />
          {actionData?.errors.displayName?.[0] ? (
            <span className="text-sm text-red-700">
              {actionData.errors.displayName[0]}
            </span>
          ) : null}
        </label>
        <button
          className="bg-neutral-950 px-5 py-3 font-semibold text-white"
          type="submit"
        >
          베타 로그인
        </button>
      </Form>
    </main>
  );
}
