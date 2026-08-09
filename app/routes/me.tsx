import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/me";
import { AccountConnections } from "../components/me/AccountConnections";
import { ActivityCollection } from "../components/me/ActivityCollection";
import { TasteSignals } from "../components/me/TasteSignals";
import { createDb } from "../db/client.server";
import { authIdentities, users } from "../db/schema";
import { naverOAuthErrorMessage } from "../features/auth/naver-auth-ui";
import { requireUser } from "../features/auth/session.server";
import { listMemberTaste } from "../features/members/member.server";
import { getMemberTasteProfile } from "../features/members/profile-taste.server";
import { getMemberTasteGraph } from "../features/ratings/flavor-print.server";
import { setSaved } from "../features/saves/save.server";

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
  const user = await requireUser(request);
  const form = await request.formData();
  await setSaved(createDb(env.DB), {
    userId: user.id,
    placeId: String(form.get("placeId") ?? ""),
    saved: false,
    now: new Date().toISOString(),
  });
  return redirect("/me");
}

export default function Me({ loaderData }: Route.ComponentProps) {
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
          <ActivityCollection
            title="저장한 장소"
            count={loaderData.saved.length}
            emptyText="지도에서 다시 보고 싶은 장소를 저장해 보세요."
            emptyHref="/places"
          >
            {loaderData.saved.map((place) => <article className="member-place-row" key={place.id}>
              <div>
                <p>{place.categoryEmoji} {place.categoryName} · {place.neighborhood}</p>
                <h3><Link to={`/places/${place.slug}`}>{place.name}</Link></h3>
              </div>
              <Form method="post">
                <input type="hidden" name="placeId" value={place.id} />
                <button>저장 해제</button>
              </Form>
            </article>)}
          </ActivityCollection>

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
    </div>
  </main>;
}
