import { env } from "cloudflare:workers";
import { data, Form, Link } from "react-router";

import type { Route } from "./+types/admin-import";
import { createDb } from "../db/client.server";
import { readSessionId, requireAdmin } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { MAX_ADMIN_CSV_BYTES, MAX_ADMIN_CSV_ROWS, parsePlaceCsv } from "../features/places/import.server";
import { buildPlaceImportBatch, parseImportSnapshot, snapshotPlaceImport } from "../features/places/import-operation.server";
import { commitAdminOperation, getAdminOperation, prepareAdminOperation } from "../features/operations/admin-operation.server";

// Bound the complete multipart body before allocating/parsing it, including when
// Content-Length is absent. File bytes and normalized payload are checked again.
async function readImportForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Response("요청 내용이 없습니다.", { status: 400 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ADMIN_CSV_BYTES + 64 * 1024) {
      await reader.cancel();
      throw new Response("CSV는 2MiB 이하여야 합니다.", { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") ?? "" } }).formData();
  } catch {
    throw new Response("CSV 요청 형식을 확인해 주세요.", { status: 400 });
  }
}

interface ImportActionData {
  errors: Array<{ row: number; field: string; message: string }>;
  preview: Array<{ name: string; slug: string; status: string }>;
  operationId: string;
  expiresAt: string;
  imported: number;
  reauthHref?: string;
}

function emptyActionData(): ImportActionData {
  return { errors: [], preview: [], operationId: "", expiresAt: "", imported: 0 };
}

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request);
  const operationId = new URL(request.url).searchParams.get("operation");
  if (!operationId) return emptyActionData();
  const sessionId = readSessionId(request);
  if (!sessionId) throw new Response("다시 로그인해 주세요.", { status: 401 });
  try {
    return await operationPreview({ operationId, actorUserId: admin.id, sessionId, kind: "CSV_IMPORT", now: new Date().toISOString() });
  } catch {
    return { ...emptyActionData(), errors: [{ row: 1, field: "csv", message: "검증 내용이 만료되었거나 변경되었습니다. 파일을 다시 검증해 주세요." }] };
  }
}

async function operationPreview(input: { operationId: string; actorUserId: string; sessionId: string; kind: "CSV_IMPORT"; now: string }): Promise<ImportActionData> {
  const operation = await getAdminOperation(env.DB, input);
  if (operation.status === "COMMITTED") return { ...emptyActionData(), imported: Number((operation.result as { imported: number }).imported) };
  const snapshot = parseImportSnapshot(operation.payload);
  return { ...emptyActionData(), operationId: operation.id, expiresAt: operation.expiresAt, preview: snapshot.entries.map(({ row }) => ({ name: row.name, slug: row.slug, status: row.status })) };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const sessionId = readSessionId(request);
  if (!sessionId) throw new Response("다시 로그인해 주세요.", { status: 401 });
  const form = await readImportForm(request);
  const intent = form.get("intent");
  if (form.getAll("intent").length !== 1 || (intent !== "validate" && intent !== "confirm")) throw new Response("잘못된 요청입니다.", { status: 400 });
  const allowed = intent === "confirm" ? ["intent", "operationId"] : ["intent", "file"];
  if ([...form.keys()].some((key) => !allowed.includes(key))) throw new Response("검증한 요청을 다시 사용해 주세요.", { status: 400 });
  const now = new Date().toISOString();
  const context = { actorUserId: admin.id, sessionId, kind: "CSV_IMPORT" as const, now };
  if (intent === "confirm") {
    const operationId = form.get("operationId");
    if (typeof operationId !== "string" || !operationId || operationId.length > 100 || form.getAll("operationId").length !== 1) throw new Response("다시 검증해 주세요.", { status: 400 });
    try {
      const committed = await commitAdminOperation(env.DB, { ...context, operationId }, async (operation) =>
        buildPlaceImportBatch(env.DB, operation.id, operation.payload, now));
      return data<ImportActionData>({ ...emptyActionData(), imported: Number((committed.result as { imported: number }).imported) });
    } catch (error) {
      if (error instanceof Error && error.message === "ADMIN_RECENT_AUTH_REQUIRED") {
        const preview = await operationPreview({ ...context, operationId });
        return data<ImportActionData>({ ...preview, reauthHref: `/admin/reauth?returnTo=${encodeURIComponent(`/admin/import?operation=${operationId}`)}`, errors: [{ row: 1, field: "확인", message: "가져오기를 반영하려면 관리자 재인증이 필요합니다." }] }, { status: 403 });
      }
      return data<ImportActionData>({ ...emptyActionData(), errors: [{ row: 1, field: "확인", message: "반영할 내용을 확인할 수 없거나 장소·분류가 변경되었습니다. 파일을 다시 검증해 주세요." }] }, { status: 409 });
    }
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || form.getAll("file").length !== 1) {
    return data<ImportActionData>({ ...emptyActionData(), errors: [{ row: 1, field: "file", message: "CSV 파일을 선택해 주세요." }] }, { status: 400 });
  }
  if (file.size > MAX_ADMIN_CSV_BYTES) {
    return data<ImportActionData>({ ...emptyActionData(), errors: [{ row: 1, field: "file", message: "CSV는 2MiB 이하여야 합니다." }] }, { status: 413 });
  }
  const parsed = parsePlaceCsv(await file.text(), { maxBytes: MAX_ADMIN_CSV_BYTES, maxRows: MAX_ADMIN_CSV_ROWS, allowPublished: false });
  if (parsed.errors.length) return data<ImportActionData>({ ...emptyActionData(), errors: parsed.errors }, { status: 400 });
  try {
    const payload = await snapshotPlaceImport(createDb(env.DB), parsed.rows);
    const prepared = await prepareAdminOperation(env.DB, { ...context, payload, summary: { title: "장소 CSV 가져오기", count: parsed.rows.length } });
    return data<ImportActionData>({ ...emptyActionData(), ...prepared, preview: parsed.rows.map(({ name, slug, status }) => ({ name, slug, status })) });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("PUBLISHED_PLACE_REQUIRES_REVIEW:")
      ? "이미 공개된 장소는 장소 검수 화면에서 수정해 주세요."
      : error instanceof Error && error.message.startsWith("PRIMARY_CATEGORY_NOT_FOUND:")
        ? "사용할 수 없는 대표 분류가 있습니다. CSV의 분류를 확인해 주세요."
        : "가져오기 내용을 저장할 수 없습니다. 파일 크기와 입력 내용을 확인해 주세요.";
    return data<ImportActionData>({ ...emptyActionData(), errors: [{ row: 1, field: "csv", message }] }, { status: 400 });
  }
}

export default function AdminImport({ actionData, loaderData }: Route.ComponentProps) {
  const state = actionData ?? loaderData;
  return (
    <main id="main" className="admin-page admin-page-frame mx-auto max-w-4xl px-6 py-16">
      <Link className="text-sm underline" to="/admin/places">
        ← 장소 관리
      </Link>
      <h1 className="mt-6 text-[21px] font-semibold">장소 CSV 가져오기</h1>
      <p className="mt-3 text-neutral-600">
        최대 2MiB · 200개 장소를 먼저 검증합니다. DRAFT·HIDDEN만 가져오며 공개는 장소 검수에서 진행합니다.
      </p>

      <Form method="post" encType="multipart/form-data" className="mt-8 grid gap-4">
        <input type="hidden" name="intent" value="validate" />
        <label className="grid gap-2">
          <span className="font-medium">장소 CSV</span>
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <button className="w-fit bg-neutral-950 px-5 py-3 text-white" type="submit">
          검증하기
        </button>
      </Form>

      {state?.errors.length ? (
        <section className="mt-8 border border-red-300 bg-red-50 p-5" aria-live="polite">
          <h2 className="font-semibold">가져오기 오류</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {state.errors.map((error, index) => (
              <li key={`${error.row}-${error.field}-${index}`}>
                {error.row}행 · {error.field}: {error.message}
              </li>
            ))}
          </ul>
          {state.reauthHref ? <Link className="mt-4 inline-block underline" to={state.reauthHref}>관리자 재인증 후 계속</Link> : null}
        </section>
      ) : null}

      {state?.preview.length ? (
        <section className="mt-8 border-t border-neutral-300 pt-6">
          <h2 className="text-xl font-semibold">
            {state.preview.length}개 장소 확인
          </h2>
          <ul className="mt-4 grid gap-2">
            {state.preview.map((place) => (
              <li key={place.slug}>
                {place.name} · {place.status}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-neutral-600">확인한 내용은 10분 동안 유효합니다. 반영 전에 장소나 분류가 변경되면 다시 검증해야 합니다.</p>
          <Form method="post" className="mt-6">
            <input type="hidden" name="intent" value="confirm" />
            <input type="hidden" name="operationId" value={state.operationId} />
            <button className="bg-neutral-950 px-5 py-3 text-white" type="submit">
              전체 반영하기
            </button>
          </Form>
        </section>
      ) : null}

      {state?.imported ? (
        <p className="mt-8 border border-green-300 bg-green-50 p-5" aria-live="polite">
          {state.imported}개 장소를 반영했습니다.
        </p>
      ) : null}
    </main>
  );
}
