import { sql } from "drizzle-orm";

import { userTasteBadges } from "../../db/schema";
import { currentPublicationEpochSql } from "../ratings/reviewer-publication.server";

// Manual/provider choices survive moderation. Derived activity must prove it was
// computed from the current publication state; legacy/malformed evidence fails closed.
export function currentTasteSignalCondition() {
  return sql<boolean>`(${userTasteBadges.source}<>'INFERRED' or case
    when json_valid(${userTasteBadges.evidenceJson}) then
      json_extract(${userTasteBadges.evidenceJson}, '$.algorithm')='activity-v1'
      and json_type(${userTasteBadges.evidenceJson}, '$.moderationEpoch')='integer'
      and json_extract(${userTasteBadges.evidenceJson}, '$.moderationEpoch')=${currentPublicationEpochSql()}
      and exists(select 1 from taste_learning_states current_taste where current_taste.user_id=${userTasteBadges.userId} and current_taste.version_token=json_extract(${userTasteBadges.evidenceJson}, '$.versionToken'))
    else 0 end)`;
}
