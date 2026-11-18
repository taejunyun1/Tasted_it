import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { data, Form, isRouteErrorResponse, Link, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/me";
import { AccountConnections } from "../components/me/AccountConnections";
import { ActivityCollection } from "../components/me/ActivityCollection";
import { TasteSignals } from "../components/me/TasteSignals";
import { MemberSavedPlaces } from "../components/me/MemberSavedPlaces";
import { createDb } from "../db/client.server";
import { authIdentities, users } from "../db/schema";
import { withdrawAccount } from "../features/auth/account.server";
import { naverOAuthErrorMessage } from "../features/auth/naver-auth-ui";
import { destroyUserSession, requireUser } from "../features/auth/session.server";
import { WITHDRAW_CONFIRM_PHRASE } from "../features/auth/withdraw";
import { isSameOriginMutation } from "../features/http/same-origin";
import { listMemberTaste } from "../features/members/member.server";
import { getMemberTasteProfile } from "../features/members/profile-taste.server";
import { getMemberTasteGraph } from "../features/ratings/flavor-print.server";
import { setSavedAndRefreshTaste } from "../features/saves/save.server";
import { unknownMemberSave, type MemberSaveResult } from "../features/saves/member-save-feedback";

const unsaveSchema = z.object({ intent: z.literal("unsave"), placeId: z.string().min(1).max(128).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)) });
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export const headers: Route.HeadersFunction = ({ actionHeaders }) => {
  const result = new Headers(actionHeaders);
  for (const [name, value] of Object.entries(privateHeaders)) result.set(name, value);
  return result;
};

export function meta() {
  return [{ title: "나의 취향 — Re:Taste" }, { name: "description", content: "저장과 평가를 바탕으로 쌓이는 나의 맛 취향 기록" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const [identities, account, taste, tasteGraph] = await Promise.all([
    db.select({ provider: authIdentities.provider }).from(authIdentities).where(eq(authIdentities.userId, user.id)),
    db.query.users.findFirst({ where: eq(users.id, user.id) }),
    listMemberTaste(db, user.id),
    getMemberTasteGraph(db, user.id),
  ]);
  const naverConnected = identities.some((identity) => identity.provider === "NAVER");
  const googleConnected = identities.some((identity) => identity.provider === "GOOGLE");
  const tasteProfile = await getMemberTasteProfile(db, {
    userId: user.id,
    displayName: user.displayName,
    saved: taste.saved,
    rated: taste.rated,
    tasteGraph,
  });

  return {
    user,
    ...taste,
    tasteGraph,
    tasteProfile,
    naverConnected,
    googleConnected,
    emailVerified: Boolean(account?.emailVerifiedAt),
    oauthError: url.searchParams.get("oauthProvider") === "naver"
      ? naverOAuthErrorMessage(url.searchParams.get("oauthError"))
      : null,
    oauthSuccess: url.searchParams.get("oauthSuccess"),
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) {
    throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  }
  const user = await requireUser(request);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") === "withdraw") {
    if (String(form.get("confirm") ?? "") !== WITHDRAW_CONFIRM_PHRASE) {
      return { withdrawError: "확인 문구를 정확히 입력해 주세요." };
    }
    try {
      await withdrawAccount(createDb(env.DB), { userId: user.id, now: new Date() });
    } catch (error) {
      if (error instanceof Error && error.message === "WITHDRAW_ADMIN_FORBIDDEN") {
        return { withdrawError: "관리자 계정은 이 화면에서 탈퇴할 수 없습니다." };
      }
      throw error;
    }
    throw redirect("/", { headers: { "Set-Cookie": await destroyUserSession(request) } });
  }
  const parsed = unsaveSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ kind: "member-save", ok: false, outcome: "REJECTED", placeId: "", message: "저장 해제할 장소를 확인한 뒤 다시 시도해 주세요." } satisfies MemberSaveResult, { status: 400, headers: privateHeaders });
  try {
    await setSavedAndRefreshTaste(createDb(env.DB), {
      userId: user.id,
      placeId: parsed.data.placeId,
      saved: false,
      now: new Date().toISOString(),
    });
    return data({ kind: "member-save", ok: true, outcome: "REMOVED", placeId: parsed.data.placeId, message: "저장을 해제했습니다." } satisfies MemberSaveResult, { headers: privateHeaders });
  } catch {
    console.error("MEMBER_UNSAVE_FAILED");
    return data(unknownMemberSave(parsed.data.placeId), { status: 503, headers: privateHeaders });
  }
}

export async function clientAction({ request, serverAction }: Route.ClientActionArgs) {
  const form = await request.clone().formData();
  if (form.get("intent") !== "unsave") return serverAction();
  try {
    return await serverAction();
  } catch (error) {
    if (error instanceof Response || isRouteErrorResponse(error)) throw error;
    return unknownMemberSave(String(form.get("placeId") ?? "").slice(0, 128));
  }
}

export default function Me({ loaderData, actionData }: Route.ComponentProps) {
  const withdrawError = actionData && "withdrawError" in actionData ? actionData.withdrawError : undefined;
  return <main id="main" className="member-hub">
    <div className="shell">
      <header className="member-profile">
        <div className="member-profile__person">
          <span className="member-profile__avatar" aria-hidden="true">{loaderData.user.displayName.trim().slice(0, 1)}</span>
          <div>
            <strong>{loaderData.user.displayName}</strong>
            <p className="member-profile__email">
              {loaderData.user.email}
              <span data-verified={loaderData.emailVerified || undefined}>{loaderData.emailVerified ? "이메일 확인됨" : "이메일 확인 필요"}</span>
            </p>
          </div>
        </div>

        <TasteSignals profile={loaderData.tasteProfile} placeCount={loaderData.tasteGraph.placeCount} />

        <div className="member-profile__footer">
          <div className="member-profile__stats" aria-label="나의 활동 요약">
            <span><strong>{loaderData.saved.length}</strong> 저장</span>
            <span><strong>{loaderData.rated.length}</strong> 평가</span>
            <span><strong>{loaderData.tasteProfile.vector.length}</strong> 취향 신호</span>
          </div>
          <Link className="member-reviewer-link" to="/reviewer/apply">리뷰어 신청·상태</Link>
        </div>
      </header>

      {loaderData.oauthError && <p role="alert" className="member-notice member-notice--error">{loaderData.oauthError}</p>}
      {loaderData.oauthSuccess && <p role="status" className="member-notice">
        {loaderData.oauthSuccess === "naver_connected" ? "네이버 계정을 연결했습니다." : "네이버 연동을 해제했습니다."}
      </p>}

      <section className="member-activity" aria-labelledby="member-activity-title">
        <div className="member-activity__heading">
          <p className="eyebrow">TASTE LOG</p>
          <h2 id="member-activity-title">내가 남긴 맛의 기록</h2>
        </div>
        <div className="member-activity-grid">
          <MemberSavedPlaces places={loaderData.saved} />

          <ActivityCollection
            title="내가 평가한 장소"
            count={loaderData.rated.length}
            emptyText="방문한 장소에 추천 또는 비추천을 남겨보세요."
            emptyHref="/places"
          >
            {loaderData.rated.map((place) => <article className="member-place-row" key={place.id}>
              <div>
                <p>{place.categoryEmoji} {place.categoryName} · {place.neighborhood}</p>
                <h3><Link to={`/places/${place.slug}`}>{place.name}</Link></h3>
              </div>
              <span className="member-rating-state" data-positive={place.value === 1 || undefined}>{place.value === 1 ? "추천했어요" : "비추천했어요"}</span>
            </article>)}
          </ActivityCollection>
        </div>
      </section>

      <AccountConnections naverConnected={loaderData.naverConnected} googleConnected={loaderData.googleConnected} />

      <section className="member-withdraw" aria-labelledby="member-withdraw-title">
        <details>
          <summary>회원 탈퇴</summary>
          <h2 id="member-withdraw-title">회원 탈퇴</h2>
          <p>탈퇴하면 로그인, 소셜 연동, 저장한 장소는 삭제되고 복구할 수 없습니다. 이미 반영된 추천·비추천은 점수 유지를 위해 익명으로 남습니다.</p>
          {withdrawError && <p role="alert" className="member-notice member-notice--error">{withdrawError}</p>}
          <Form method="post">
            <input type="hidden" name="intent" value="withdraw" />
            <label>
              확인을 위해 {WITHDRAW_CONFIRM_PHRASE}를 입력하세요
              <input name="confirm" type="text" autoComplete="off" placeholder={WITHDRAW_CONFIRM_PHRASE} />
            </label>
            <button type="submit">탈퇴하기</button>
          </Form>
        </details>
      </section>
    </div>
  </main>;
}
