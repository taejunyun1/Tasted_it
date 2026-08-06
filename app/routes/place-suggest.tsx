import { env } from "cloudflare:workers";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { data, Form, Link } from "react-router";
import type { Route } from "./+types/place-suggest";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireUser } from "../features/auth/session.server";
import { extractNeighborhood } from "../features/candidates/category-suggestion";
import { submitPlaceSuggestion } from "../features/places/place-suggestion.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request); const db = createDb(env.DB);
  return { categories: await db.select({ id: categories.id, name: categories.name, emoji: categories.emoji }).from(categories).where(and(eq(categories.isActive, true), isNotNull(categories.parentId))).orderBy(asc(categories.sortOrder)) };
}
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request); const form = await request.formData(); const address = String(form.get("address") ?? "").trim(); const neighborhood = extractNeighborhood(address);
  if (!neighborhood) return data({ error: "주소에서 동·읍·면·리를 확인할 수 없습니다." }, { status: 400 });
  try {
    const result = await submitPlaceSuggestion(createDb(env.DB), { id: crypto.randomUUID(), userId: user.id, name: String(form.get("name") ?? ""), address, neighborhood, latitude: form.get("latitude") ? Number(form.get("latitude")) : null, longitude: form.get("longitude") ? Number(form.get("longitude")) : null, phone: String(form.get("phone") ?? "") || null, categoryId: String(form.get("categoryId") ?? ""), description: String(form.get("description") ?? "") || null, duplicateOverrideReason: String(form.get("duplicateOverrideReason") ?? "") || null, now: new Date().toISOString() });
    return { ok: true, message: `제안을 접수했습니다. 중복 후보 ${result.duplicates.length}곳`, error: null };
  } catch (error) { const code = error instanceof Error ? error.message : "UNKNOWN"; return data({ error: code === "DUPLICATE_CONFIRMATION_REQUIRED" ? "비슷한 장소가 있습니다. 별도 장소인 이유를 적어 다시 제출해 주세요." : code, ok: false }, { status: 400 }); }
}
export default function PlaceSuggest({ loaderData, actionData }: Route.ComponentProps) { return <main id="main" className="operation-form shell"><p className="eyebrow">MEMBER / PLACE SUGGESTION</p><h1>새 장소 제안</h1><p>관리자 승인 전에는 지도에 공개되지 않습니다. 좌표를 모르면 비워 두고 주소 확인을 요청할 수 있습니다.</p>{actionData && "error" in actionData && actionData.error && <p className="operation-error">{actionData.error}</p>}{actionData && "message" in actionData && actionData.message && <p className="operation-success">{actionData.message} · <Link to="/me/suggestions">처리 상태 보기</Link></p>}<Form method="post"><label>상호명<input name="name" required/></label><label>주소<input name="address" required/></label><label>대표 카테고리<select name="categoryId" required>{loaderData.categories.map((category) => <option value={category.id} key={category.id}>{category.emoji} {category.name}</option>)}</select></label><label>전화번호<input name="phone"/></label><div className="operation-coordinates"><label>위도<input name="latitude" type="number" step="any"/></label><label>경도<input name="longitude" type="number" step="any"/></label></div><label>추천 이유<textarea name="description" rows={4}/></label><label>비슷한 장소와 다른 이유<input name="duplicateOverrideReason" placeholder="중복 경고가 나온 경우에만 입력"/></label><button>비공개 제안 접수</button></Form></main>; }
