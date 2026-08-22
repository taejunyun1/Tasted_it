import { env } from "cloudflare:workers";
import { useState } from "react";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { data, Form, Link } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/place-suggest";
import { PlaceLocationPicker } from "../components/places/PlaceLocationPicker";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireUser } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { extractPlaceNeighborhood } from "../features/maps/place-location";
import { submitPlaceSuggestion } from "../features/places/place-suggestion.server";

const suggestionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(5).max(300),
  originLatitude: z.coerce.number().finite(),
  originLongitude: z.coerce.number().finite(),
  latitude: z.coerce.number().finite(),
  longitude: z.coerce.number().finite(),
  locationConfirmed: z.literal("true"),
  neighborhood: z.string().trim().max(80).transform((value) => value || null),
  // Category IDs are stable seeded identifiers such as `cat-ramen`, not UUIDs.
  // The server still verifies that the category is active before it persists a suggestion.
  categoryId: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).transform((value) => value || null),
  description: z.string().trim().max(1_000).transform((value) => value || null),
  duplicateOverrideReason: z.string().trim().max(300).transform((value) => value || null),
});

function suggestionErrorMessage(code: string) {
  if (code === "LOCATION_REQUIRED") return "지도에서 위치를 확인한 뒤 제안해 주세요.";
  if (code === "LOCATION_OUT_OF_SCOPE") return "광주·전남 범위 안의 주소와 위치만 제안할 수 있어요.";
  if (code === "DUPLICATE_CONFIRMATION_REQUIRED") return "비슷한 장소가 있습니다. 별도 장소인 이유를 적어 다시 제출해 주세요.";
  if (code === "EMAIL_VERIFICATION_REQUIRED") return "이메일 인증을 완료한 뒤 장소를 제안할 수 있어요.";
  return "제안을 접수하지 못했어요. 입력 내용을 확인한 뒤 다시 시도해 주세요.";
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const db = createDb(env.DB);
  const placeGeocodingEnabled = env.NAVER_PLACE_GEOCODING_ENABLED === "true";
  return {
    categories: await db.select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories)
      .where(and(eq(categories.isActive, true), isNotNull(categories.parentId)))
      .orderBy(asc(categories.sortOrder)),
    naverMapsClientId: placeGeocodingEnabled ? env.NAVER_MAPS_CLIENT_ID ?? "" : "",
    placeGeocodingEnabled,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const user = await requireUser(request);
  const form = await request.formData();
  const parsed = suggestionSchema.safeParse({
    name: form.get("name"),
    address: form.get("address"),
    originLatitude: form.get("originLatitude"),
    originLongitude: form.get("originLongitude"),
    latitude: form.get("latitude"),
    longitude: form.get("longitude"),
    locationConfirmed: form.get("locationConfirmed"),
    neighborhood: form.get("neighborhood") ?? "",
    categoryId: form.get("categoryId"),
    phone: form.get("phone") ?? "",
    description: form.get("description") ?? "",
    duplicateOverrideReason: form.get("duplicateOverrideReason") ?? "",
  });
  if (!parsed.success) return data({ ok: false, error: "입력한 장소와 지도 위치를 다시 확인해 주세요." }, { status: 400 });

  const neighborhood = parsed.data.neighborhood ?? extractPlaceNeighborhood(parsed.data.address);
  if (!neighborhood) return data({ ok: false, error: "주소에서 동·읍·면·리를 확인할 수 없습니다." }, { status: 400 });

  try {
    const result = await submitPlaceSuggestion(createDb(env.DB), {
      id: crypto.randomUUID(),
      userId: user.id,
      name: parsed.data.name,
      address: parsed.data.address,
      neighborhood,
      originLatitude: parsed.data.originLatitude,
      originLongitude: parsed.data.originLongitude,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      phone: parsed.data.phone,
      categoryId: parsed.data.categoryId,
      description: parsed.data.description,
      duplicateOverrideReason: parsed.data.duplicateOverrideReason,
      now: new Date().toISOString(),
    });
    return { ok: true, message: `제안을 접수했습니다. 중복 후보 ${result.duplicates.length}곳`, error: null };
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    return data({ ok: false, error: suggestionErrorMessage(code) }, { status: 400 });
  }
}

export default function PlaceSuggest({ loaderData, actionData }: Route.ComponentProps) {
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const geocodingAvailable = loaderData.placeGeocodingEnabled && Boolean(loaderData.naverMapsClientId);

  return (
    <main id="main" className="operation-form shell">
      <p className="eyebrow">MEMBER / PLACE SUGGESTION</p>
      <h1>새 장소 제안</h1>
      <p>관리자 승인 전에는 지도에 공개되지 않습니다. 주소를 찾고 지도 핀을 확인한 뒤 비공개로 접수해 주세요.</p>
      {actionData && "error" in actionData && actionData.error && <p className="operation-error" role="alert">{actionData.error}</p>}
      {actionData && "message" in actionData && actionData.message && <p className="operation-success" role="status">{actionData.message} · <Link to="/me/suggestions">처리 상태 보기</Link></p>}
      <Form method="post">
        <label>상호명<input name="name" required maxLength={120} /></label>
        {geocodingAvailable ? (
          <PlaceLocationPicker
            clientId={loaderData.naverMapsClientId}
            mode="MEMBER"
            required
            onConfirmedChange={setLocationConfirmed}
          />
        ) : (
          <p className="operation-error" role="status">현재 위치 검색을 잠시 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요.</p>
        )}
        <label>대표 카테고리
          <select name="categoryId" required defaultValue="">
            <option value="" disabled>카테고리를 선택해 주세요</option>
            {loaderData.categories.map((category) => <option value={category.id} key={category.id}>{category.emoji} {category.name}</option>)}
          </select>
        </label>
        <label>전화번호<input name="phone" maxLength={40} inputMode="tel" /></label>
        <label>추천 이유<textarea name="description" rows={4} maxLength={1_000} /></label>
        <label>비슷한 장소와 다른 이유<input name="duplicateOverrideReason" maxLength={300} placeholder="중복 경고가 나온 경우에만 입력" /></label>
        <button disabled={!locationConfirmed}>비공개 제안 접수</button>
      </Form>
    </main>
  );
}
