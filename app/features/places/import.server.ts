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

export function parsePlaceCsv(text: string): PlaceImportResult {
  let records: CsvRecord[];
  try {
    records = parse(text, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
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
