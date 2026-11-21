import { z } from "zod";
import { ACTIVITY_KINDS, type ActivityKind, type ActivityView } from "./admin-activity";

export const EXPORT_MAX_ROWS = 200;
export const EXPORT_MAX_DAYS = 31;
export class ExportInputError extends Error {}
const inputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  view: z.enum(["audit", "operations"]), kind: z.string(),
  limit: z.string().regex(/^\d{1,3}$/), cursor: z.string().max(3000).optional(),
}).strict();
export type ExportQuery = {
  from: string; to: string; view: ActivityView; kind: ActivityKind | "all"; limit: number;
  activityCursor: string | null;
};
function filterKey(query: ExportQuery) {
  return JSON.stringify([query.from, query.to, query.view, query.kind, query.limit]);
}
export function encodeExportCursor(query: ExportQuery, activityCursor: string) {
  const value = JSON.stringify({ version: 1, filter: filterKey(query), cursor: activityCursor });
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function parseExportQuery(params: URLSearchParams): ExportQuery {
  try {
    const values: Record<string, string> = Object.create(null);
    for (const [key, value] of params) {
      if (Object.hasOwn(values, key)) throw new ExportInputError();
      values[key] = value;
    }
    const parsed = inputSchema.parse(values);
    const from = new Date(`${parsed.from}T00:00:00.000Z`), end = new Date(`${parsed.to}T00:00:00.000Z`);
    if (from.toISOString().slice(0, 10) !== parsed.from || end.toISOString().slice(0, 10) !== parsed.to) throw new ExportInputError();
    const days = (end.getTime() - from.getTime()) / 86_400_000 + 1;
    const limit = Number(parsed.limit);
    if (days < 1 || days > EXPORT_MAX_DAYS || limit < 1 || limit > EXPORT_MAX_ROWS
      || (parsed.kind !== "all" && !Object.hasOwn(ACTIVITY_KINDS, parsed.kind))) throw new ExportInputError();
    const query: ExportQuery = { from: from.toISOString(), to: new Date(end.getTime() + 86_400_000).toISOString(),
      view: parsed.view, kind: parsed.kind as ExportQuery["kind"], limit, activityCursor: null };
    if (parsed.cursor) {
      if (!/^[A-Za-z0-9_-]+$/.test(parsed.cursor)) throw new ExportInputError();
      const decoded = z.object({ version: z.literal(1), filter: z.string(), cursor: z.string().min(1).max(1024) }).strict()
        .parse(JSON.parse(atob(parsed.cursor.replace(/-/g, "+").replace(/_/g, "/"))));
      if (decoded.filter !== filterKey(query)) throw new ExportInputError();
      query.activityCursor = decoded.cursor;
    }
    return query;
  } catch { throw new ExportInputError(); }
}
type ExportRow = { key: string; createdAt: string | null; actor: string; title: string; target: string; state: string; [key: string]: unknown };
function cell(value: string | null) {
  const text = value ?? "";
  const safe = /^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function serializeActivityCsv(rows: ExportRow[]) {
  const header = ["기록 참조", "기록 시각(UTC)", "행위자 참조", "작업", "대상 참조", "기록 상태"];
  return "\uFEFF" + [header, ...rows.map((row) => [row.key, row.createdAt, row.actor, row.title, row.target, row.state])]
    .map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
