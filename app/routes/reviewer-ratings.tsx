import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import type { Route } from "./+types/reviewer-ratings";

import { createDb } from "../db/client.server";
import { categories, flavorTemplates, placeCategories, places } from "../db/schema";
import { assertRole } from "../features/auth/guards.server";
import { requireUser } from "../features/auth/session.server";
import { submitFlavorRating } from "../features/ratings/flavor-print.server";
import { grantGoldenPick, listActiveGoldenPicks } from "../features/ratings/golden-pick.server";
import { listReviewerHotTakes } from "../features/ratings/rating-badges.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  assertRole(user.role, ["REVIEWER"]);
  const db = createDb(env.DB);
  const rows = await db.select({
    placeId: places.id, placeSlug: places.slug, placeName: places.name, neighborhood: places.neighborhood,
    categoryName: categories.name, categoryEmoji: categories.emoji,
    templateId: flavorTemplates.id, templateVersion: flavorTemplates.version, dimensionsJson: flavorTemplates.dimensionsJson,
  }).from(places)
    .innerJoin(placeCategories, and(eq(placeCategories.placeId, places.id), eq(placeCategories.isPrimary, true)))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .leftJoin(flavorTemplates, and(eq(flavorTemplates.categoryId, categories.id), eq(flavorTemplates.status, "ACTIVE")))
    .where(eq(places.status, "PUBLISHED"))
    .orderBy(asc(places.name));
  const [activePicks, hotTakes] = await Promise.all([
    listActiveGoldenPicks(db, new Date().toISOString(), user.id),
    listReviewerHotTakes(db, user.id),
  ]);
  return { user, activePicks, places: rows.map((row) => ({ ...row, dimensions: row.dimensionsJson ? JSON.parse(row.dimensionsJson) as string[] : [], hotTake: hotTakes.get(row.placeId) ?? null })) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  assertRole(user.role, ["REVIEWER"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const placeId = String(form.get("placeId") ?? "");
  const now = new Date().toISOString();
  const db = createDb(env.DB);
  if (intent === "golden") {
    await grantGoldenPick(db, { id: crypto.randomUUID(), reviewerUserId: user.id, placeId, now });
  } else if (intent === "flavor") {
    const templateId = String(form.get("templateId") ?? "");
    const template = await db.query.flavorTemplates.findFirst({ where: eq(flavorTemplates.id, templateId) });
    if (!template) throw new Response("Template not found", { status: 400, statusText: "FLAVOR_TEMPLATE_NOT_FOUND" });
    const dimensions = JSON.parse(template.dimensionsJson) as string[];
    const values = Object.fromEntries(dimensions.map((dimension, index) => [dimension, Number(form.get(`dimension-${index}`))]));
    const confidence = String(form.get("confidence") ?? "MEDIUM");
    if (confidence !== "LOW" && confidence !== "MEDIUM" && confidence !== "HIGH") throw new Response("Invalid confidence", { status: 400 });
    await submitFlavorRating(db, { id: crypto.randomUUID(), reviewerUserId: user.id, placeId, templateId, values, confidence, now });
  } else {
    throw new Response("Invalid intent", { status: 400 });
  }
  return redirect("/reviewer/ratings");
}

export function meta() { return [{ title: "리뷰어 평가 — Re:Taste" }]; }

export default function ReviewerRatings({ loaderData }: Route.ComponentProps) {
  return <main id="main" className="reviewer-rating-shell"><header><p className="eyebrow">REVIEWER / BLIND FIELD NOTE</p><h1>리뷰어 평가</h1><p>다른 리뷰어의 결과는 제출 전에 공개하지 않습니다. Flavor Print와 Golden Pick은 서로 독립적으로 기록됩니다.</p><strong>활성 Golden Pick {loaderData.activePicks.length}개</strong></header><section className="reviewer-rating-list">{loaderData.places.map((place) => <article key={place.placeId}><div><p>{place.categoryEmoji} {place.categoryName} · {place.neighborhood}</p><h2>{place.placeName}</h2>{place.hotTake?.eligible && <p className="hot-take-note">HOT TAKE · 동료 {place.hotTake.peerCount}명 중 {Math.round(place.hotTake.peerAgreement * 100)}%와 다른 관점</p>}</div>{place.templateId ? <Form method="post" className="flavor-form"><input type="hidden" name="intent" value="flavor"/><input type="hidden" name="placeId" value={place.placeId}/><input type="hidden" name="templateId" value={place.templateId}/><fieldset><legend>Flavor Print · {place.templateVersion}</legend>{place.dimensions.map((dimension, index) => <label key={dimension}><span>{dimension}</span><select name={`dimension-${index}`} defaultValue="3" aria-label={`${place.placeName} ${dimension}`}><option value="1">1 · 약함</option><option value="2">2</option><option value="3">3 · 보통</option><option value="4">4</option><option value="5">5 · 강함</option></select></label>)}</fieldset><label><span>확신도</span><select name="confidence" defaultValue="MEDIUM"><option value="LOW">낮음</option><option value="MEDIUM">보통</option><option value="HIGH">높음</option></select></label><button>Flavor Print 저장</button></Form> : <p className="template-empty">이 카테고리의 Flavor Print 템플릿 준비 중</p>}<Form method="post"><input type="hidden" name="intent" value="golden"/><input type="hidden" name="placeId" value={place.placeId}/><button className="golden-button">Golden Pick 부여</button></Form></article>)}</section></main>;
}
