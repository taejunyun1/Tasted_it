import { parse } from "csv-parse/sync";
import { z } from "zod";

import type {
  PlaceImportError,
  PlaceImportResult,
  PlaceImportRow,
} from "./place.types";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || null);

const rowSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  address: z.string().trim().min(1),
  neighborhood: z.string().trim().min(1),
  latitude: z.coerce.number().min(33).max(39),
  longitude: z.coerce.number().min(124).max(132),
  primary_category: z.string().trim().min(1),
  phone: optionalText,
  parking_summary: optionalText,
  kakao_place_id: optionalText,
  hero_image_url: z
    .union([z.literal(""), z.url().refine((url) => /^https?:\/\//.test(url))])
    .optional()
    .transform((value) => value || null),
  status: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]).optional().default("DRAFT"),
});

type CsvRecord = Record<string, string | undefined>;

function fieldName(path: PropertyKey[]): string {
  return typeof path[0] === "string" ? path[0] : "row";
}

export const MAX_ADMIN_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_ADMIN_CSV_ROWS = 200;

export function parsePlaceCsv(text: string, options: { maxBytes?: number; maxRows?: number; allowPublished?: boolean } = {}): PlaceImportResult {
  if (options.maxBytes && new TextEncoder().encode(text).byteLength > options.maxBytes) {
    return { rows: [], errors: [{ row: 1, field: "csv", message: "CSV는 2MiB 이하여야 합니다." }] };
  }
  let records: CsvRecord[];
  try {
    records = parse(text, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      ...(options.maxRows ? { to: options.maxRows + 1 } : {}),
    });
  } catch (error) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          field: "csv",
          message: error instanceof Error ? error.message : "CSV 형식을 읽을 수 없습니다.",
        },
      ],
    };
  }

  if (options.maxRows && records.length > options.maxRows) {
    return { rows: [], errors: [{ row: 1, field: "csv", message: `CSV는 ${options.maxRows}행 이하여야 합니다.` }] };
  }
  if (!records.length) return { rows: [], errors: [{ row: 1, field: "csv", message: "가져올 장소가 없습니다." }] };
  const slugs = new Set<string>();
  const rows: PlaceImportRow[] = [];
  const errors: PlaceImportError[] = [];

  records.forEach((record, index) => {
    const parsed = rowSchema.safeParse(record);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: index + 2,
          field: fieldName(issue.path),
          message: issue.message,
        });
      }
      return;
    }

    const value = parsed.data;
    if (slugs.has(value.slug)) {
      errors.push({ row: index + 2, field: "slug", message: "같은 파일에 중복된 slug가 있습니다." });
      return;
    }
    slugs.add(value.slug);
    if (options.allowPublished === false && value.status === "PUBLISHED") {
      errors.push({ row: index + 2, field: "status", message: "공개는 장소 검수 화면에서 진행해 주세요. CSV는 DRAFT 또는 HIDDEN만 허용합니다." });
      return;
    }
    rows.push({
      name: value.name,
      slug: value.slug,
      address: value.address,
      neighborhood: value.neighborhood,
      latitude: value.latitude,
      longitude: value.longitude,
      primaryCategory: value.primary_category,
      phone: value.phone,
      parkingSummary: value.parking_summary,
      kakaoPlaceId: value.kakao_place_id,
      heroImageUrl: value.hero_image_url,
      status: value.status,
      searchText: [
        value.name,
        value.address,
        value.neighborhood,
        value.primary_category,
      ]
        .join(" ")
        .toLocaleLowerCase("ko-KR"),
    });
  });

  return { rows, errors };
}
