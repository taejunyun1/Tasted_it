import { env } from "cloudflare:workers";
import { data, Form, Link } from "react-router";

import type { Route } from "./+types/admin-import";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { parsePlaceCsv } from "../features/places/import.server";
import { importPlaceRows } from "../features/places/place.server";

const MAX_CSV_BYTES = 2 * 1024 * 1024;

interface ImportActionData {
  errors: Array<{ row: number; field: string; message: string }>;
  preview: Array<{ name: string; slug: string; status: string }>;
  csv: string;
  imported: number;
}

function emptyActionData(): ImportActionData {
  return { errors: [], preview: [], csv: "", imported: 0 };
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  let csv = "";
  if (intent === "confirm") {
    const value = formData.get("csv");
    csv = typeof value === "string" ? value : "";
  } else {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return data<ImportActionData>(
        {
          ...emptyActionData(),
          errors: [{ row: 1, field: "file", message: "CSV 파일을 선택해 주세요." }],
        },
        { status: 400 },
      );
    }
    if (file.size > MAX_CSV_BYTES) {
      return data<ImportActionData>(
        {
          ...emptyActionData(),
          errors: [{ row: 1, field: "file", message: "CSV는 2MB 이하여야 합니다." }],
        },
        { status: 413 },
      );
    }
    csv = await file.text();
  }

  const parsed = parsePlaceCsv(csv);
  if (parsed.errors.length > 0) {
    return data<ImportActionData>(
      { ...emptyActionData(), errors: parsed.errors, csv },
      { status: 400 },
    );
  }

  if (intent !== "confirm") {
    return data<ImportActionData>({
      errors: [],
      preview: parsed.rows.map(({ name, slug, status }) => ({ name, slug, status })),
      csv,
      imported: 0,
    });
  }

  await importPlaceRows(createDb(env.DB), {
    rows: parsed.rows,
    ids: parsed.rows.map(() => crypto.randomUUID()),
    now: new Date().toISOString(),
  });

  return data<ImportActionData>({
    ...emptyActionData(),
    imported: parsed.rows.length,
  });
}

export default function AdminImport({ actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Link className="text-sm underline" to="/admin/places">
        ← 장소 관리
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">장소 CSV 가져오기</h1>
      <p className="mt-3 text-neutral-600">
        먼저 전체 행을 검증하고, 오류가 없을 때만 한 번에 반영합니다.
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

      {actionData?.errors.length ? (
        <section className="mt-8 border border-red-300 bg-red-50 p-5" aria-live="polite">
          <h2 className="font-semibold">가져오기 오류</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {actionData.errors.map((error, index) => (
              <li key={`${error.row}-${error.field}-${index}`}>
                {error.row}행 · {error.field}: {error.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {actionData?.preview.length ? (
        <section className="mt-8 border-t border-neutral-300 pt-6">
          <h2 className="text-xl font-semibold">
            {actionData.preview.length}개 장소 확인
          </h2>
          <ul className="mt-4 grid gap-2">
            {actionData.preview.map((place) => (
              <li key={place.slug}>
                {place.name} · {place.status}
              </li>
            ))}
          </ul>
          <Form method="post" className="mt-6">
            <input type="hidden" name="intent" value="confirm" />
            <textarea hidden readOnly name="csv" value={actionData.csv} />
            <button className="bg-neutral-950 px-5 py-3 text-white" type="submit">
              전체 반영하기
            </button>
          </Form>
        </section>
      ) : null}

      {actionData?.imported ? (
        <p className="mt-8 border border-green-300 bg-green-50 p-5" aria-live="polite">
          {actionData.imported}개 장소를 반영했습니다.
        </p>
      ) : null}
    </main>
  );
}
