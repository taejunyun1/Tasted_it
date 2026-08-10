import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/taste-onboarding";
import { TasteOnboarding } from "../components/onboarding/TasteOnboarding";
import { createDb } from "../db/client.server";
import { guestTasteSessions } from "../db/schema";
import { getOptionalUser } from "../features/auth/session.server";
import {
  getGuestOnboarding,
  getOrCreateGuestSession,
  saveGuestOnboarding,
} from "../features/onboarding/guest-session.server";
import { TASTE_BADGE_CATALOG } from "../features/members/profile-taste-badges";

const onboardingAction = z.object({
  intent: z.enum(["SAVE_STEP", "SKIP", "COMPLETE"]),
  step: z.enum(["LOCATION", "FOOD", "STYLE", "PREVIEW"]),
  locationMode: z.enum(["DEVICE", "DEFAULT"]).default("DEFAULT"),
  foodBadgeIds: z.array(z.string()).max(5).default([]),
  styleBadgeIds: z.array(z.string()).max(3).default([]),
  returnTo: z.string().default("/places"),
});

export function safeOnboardingReturnTo(value: string | null | undefined) {
  const fallback = "/places";
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;

  let decoded = value;
  try {
    for (let count = 0; count < 3; count += 1) {
      const next = decodeURIComponent(decoded);
      if (next.includes("\\") || next.startsWith("//")) return fallback;
      if (next === decoded) break;
      decoded = next;
    }
    const base = new URL("https://retaste.invalid");
    const destination = new URL(decoded, base);
    if (destination.origin !== base.origin) return fallback;
    return value;
  } catch {
    return fallback;
  }
}

export function meta() {
  return [{ title: "취향 설정 | Re:Taste" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeOnboardingReturnTo(url.searchParams.get("returnTo"));
  if (env.ONBOARDING_ENABLED !== "true") return redirect(returnTo);
  if (await getOptionalUser(request)) return redirect(returnTo);

  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const { session, setCookie } = await getOrCreateGuestSession(db, request, now);
  const state = await getGuestOnboarding(db, session.id, now);
  if (!state) throw new Response("온보딩 세션을 준비하지 못했습니다.", { status: 500 });

  const payload = {
    initialState: {
      step: state.step,
      locationMode: state.locationMode,
      foodBadgeIds: state.foodBadgeIds,
      styleBadgeIds: state.styleBadgeIds,
    },
    foodBadges: TASTE_BADGE_CATALOG.filter((badge) => badge.category === "FOOD"),
    styleBadges: TASTE_BADGE_CATALOG.filter((badge) => badge.category === "TASTE" || badge.category === "STYLE"),
    returnTo,
  };
  return data(payload, setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined);
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = onboardingAction.safeParse({
    intent: form.get("intent"),
    step: form.get("step"),
    locationMode: form.get("locationMode") ?? undefined,
    foodBadgeIds: form.getAll("foodBadgeId").filter((value): value is string => typeof value === "string"),
    styleBadgeIds: form.getAll("styleBadgeId").filter((value): value is string => typeof value === "string"),
    returnTo: form.get("returnTo") ?? undefined,
  });
  if (!parsed.success) return data({ ok: false, message: "선택 내용을 다시 확인해 주세요." }, { status: 400 });

  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const { session, setCookie } = await getOrCreateGuestSession(db, request, now);
  try {
    await saveGuestOnboarding(db, {
      sessionId: session.id,
      step: parsed.data.step,
      locationMode: parsed.data.locationMode,
      foodBadgeIds: parsed.data.foodBadgeIds,
      styleBadgeIds: parsed.data.styleBadgeIds,
      now,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "GUEST_ONBOARDING_BADGES_INVALID") {
      return data(
        { ok: false, message: "선택할 수 없는 취향이 포함되어 있어요. 다시 골라주세요." },
        { status: 400, headers: setCookie ? { "Set-Cookie": setCookie } : undefined },
      );
    }
    throw error;
  }

  if (parsed.data.intent === "SKIP" || parsed.data.intent === "COMPLETE") {
    await db.update(guestTasteSessions).set(
      parsed.data.intent === "SKIP"
        ? { skippedAt: now, updatedAt: now }
        : { completedAt: now, updatedAt: now },
    ).where(eq(guestTasteSessions.id, session.id));
    const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;
    return redirect(safeOnboardingReturnTo(parsed.data.returnTo), { headers });
  }

  return data({ ok: true }, setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined);
}

export default function TasteOnboardingRoute({ loaderData }: Route.ComponentProps) {
  return <TasteOnboarding {...loaderData} />;
}
