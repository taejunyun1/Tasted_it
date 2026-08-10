import type { AppDb } from "../../db/client.server";
import { productEvents } from "../../db/schema";

export const PRODUCT_EVENT_NAMES = [
  "ONBOARDING_STARTED",
  "ONBOARDING_STEP_COMPLETED",
  "ONBOARDING_COMPLETED",
  "ONBOARDING_SKIPPED",
  "RECOMMENDATION_DETAIL_OPENED",
  "RECOMMENDATION_SAVED",
  "RECOMMENDATION_LIKED",
  "RECOMMENDATION_DISLIKED",
  "GUEST_CONVERTED",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const PRODUCT_EVENT_METADATA_KEYS = [
  "step",
  "selectedCount",
  "sourceRail",
  "discoveryMode",
  "reason",
] as const;

export type ProductEventMetadataKey = (typeof PRODUCT_EVENT_METADATA_KEYS)[number];
export type ProductEventMetadata = Partial<Record<ProductEventMetadataKey, string | number>>;

type ExactProductEventMetadata<Metadata extends ProductEventMetadata> = Metadata
  & Record<Exclude<keyof Metadata, ProductEventMetadataKey>, never>;

export type RecordProductEventResult =
  | { recorded: true; id: string }
  | { recorded: false; id: null };

const eventNameAllowlist = new Set<string>(PRODUCT_EVENT_NAMES);
const metadataKeyAllowlist = new Set<string>(PRODUCT_EVENT_METADATA_KEYS);

function serializeMetadata(metadata: ProductEventMetadata | undefined): string {
  if (metadata === undefined) return "{}";
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("EVENT_METADATA_NOT_ALLOWED");
  }

  for (const key of Reflect.ownKeys(metadata)) {
    if (typeof key !== "string" || !metadataKeyAllowlist.has(key)) {
      throw new Error("EVENT_METADATA_NOT_ALLOWED");
    }
    const value = metadata[key as ProductEventMetadataKey];
    if (typeof value === "string") continue;
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) continue;
    throw new Error("EVENT_METADATA_NOT_ALLOWED");
  }

  return JSON.stringify(metadata);
}

export async function recordProductEvent<
  const Metadata extends ProductEventMetadata = ProductEventMetadata,
>(
  db: AppDb,
  input: {
    eventName: ProductEventName;
    guestSessionId: string | null;
    userId: string | null;
    metadata?: ExactProductEventMetadata<Metadata>;
    occurredAt: string;
  },
): Promise<RecordProductEventResult> {
  if (!eventNameAllowlist.has(input.eventName)) {
    throw new Error("PRODUCT_EVENT_NAME_NOT_ALLOWED");
  }
  const metadataJson = serializeMetadata(input.metadata);
  if (!input.guestSessionId && !input.userId) return { recorded: false, id: null };

  const id = crypto.randomUUID();
  await db.insert(productEvents).values({
    id,
    eventName: input.eventName,
    guestSessionId: input.guestSessionId,
    userId: input.userId,
    metadataJson,
    occurredAt: input.occurredAt,
  });
  return { recorded: true, id };
}
