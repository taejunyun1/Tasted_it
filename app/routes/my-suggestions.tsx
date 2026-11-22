import { env } from "cloudflare:workers"; import { desc, eq } from "drizzle-orm"; import { Link } from "react-router"; import type { Route } from "./+types/my-suggestions";
import { createDb } from "../db/client.server"; import { placeSuggestions } from "../db/schema"; import { requireUser } from "../features/auth/session.server";
import { submissionDate, suggestionState } from "../features/places/submission-feedback";
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie" });
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const items = await createDb(env.DB).select({
    id: placeSuggestions.id,
    status: placeSuggestions.status,
    name: placeSuggestions.name,
    address: placeSuggestions.address,
    reviewReason: placeSuggestions.reviewReason,
    reviewedAt: placeSuggestions.reviewedAt,
    createdAt: placeSuggestions.createdAt,
  }).from(placeSuggestions).where(eq(placeSuggestions.userId, user.id)).orderBy(desc(placeSuggestions.createdAt)).limit(100);
  return { items };
}
export default function MySuggestions({ loaderData }: Route.ComponentProps) { return <main id="main" className="operation-list shell"><header><p className="eyebrow">MY / SUGGESTIONS</p><h1>내 장소 제안</h1><Link to="/suggestions/new">새 장소 제안</Link></header>
  <p className="mt-4 text-sm text-neutral-600">최근 제안 최대 100건을 표시합니다. 승인된 제안도 공개 여부는 별도로 검토합니다.</p>
  {loaderData.items.length ? loaderData.items.map((item) => {
    const state = suggestionState(item.status), created = submissionDate(item.createdAt), reviewed = item.reviewedAt ? submissionDate(item.reviewedAt) : null;
    return <article key={item.id}><strong>{item.name}</strong><span aria-label={`처리 상태: ${state.label}`}>{state.label}</span><p>{item.address}</p><p>{state.detail}</p>
      {item.reviewReason && <p><b>검토 의견:</b> {item.reviewReason}</p>}
      <small>접수일: <time dateTime={created.dateTime}>{created.label}</time>{reviewed && <> · 검토일: <time dateTime={reviewed.dateTime}>{reviewed.label}</time></>}</small>
    </article>;
  }) : <p role="status">접수한 장소 제안이 없습니다.</p>}
</main>; }
