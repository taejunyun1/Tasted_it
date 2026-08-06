import { env } from "cloudflare:workers";
import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/admin-data-sync";
import { createDb } from "../db/client.server";
import { listSyncRuns, syncPublicDataBatch, type AddressField } from "../features/candidates/sync.server";
import type { PublicDataSource } from "../features/candidates/public-data";
import { requireAdmin } from "../features/auth/session.server";
import { buildSourceAutoClassificationReviewUrl } from "../features/candidates/auto-classification-navigation";

export async function loader({ request }: Route.LoaderArgs) { await requireAdmin(request); return { runs: await listSyncRuns(createDb(env.DB)) }; }
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const sourceType = String(form.get("sourceType")) as PublicDataSource;
  await syncPublicDataBatch(createDb(env.DB), {
    serviceKey: env.DATA_GO_KR_SERVICE_KEY ?? "",
    sourceType,
    addressField: String(form.get("addressField")) as AddressField,
  });
  return redirect(buildSourceAutoClassificationReviewUrl(sourceType));
}
export default function AdminDataSync({ loaderData }: Route.ComponentProps) { return <main className="admin-candidates shell"><header className="admin-head"><div><p className="eyebrow">ADMIN / PUBLIC DATA</p><h1>공공데이터 동기화</h1></div><Link to="/admin/candidates">후보 검수</Link></header><Form method="post" className="sync-form"><select name="sourceType"><option value="GENERAL_RESTAURANT">일반음식점</option><option value="REST_CAFE">휴게음식점</option><option value="BAKERY">제과점</option><option value="ENTERTAINMENT_BAR">유흥주점</option></select><select name="addressField"><option value="ROAD_NM_ADDR">도로명 주소</option><option value="LOTNO_ADDR">지번 주소</option></select><button>가져오고 10곳 자동 분류</button></Form><table className="sync-table"><thead><tr><th>출처/지역</th><th>상태</th><th>다음 페이지</th><th>처리</th><th>최근 실행</th></tr></thead><tbody>{loaderData.runs.map((run) => <tr key={run.id}><td>{run.sourceType} / 광주·전남</td><td>{run.status}</td><td>{run.nextPage}</td><td>{run.fetchedCount}</td><td>{run.updatedAt}</td></tr>)}</tbody></table></main>; }
