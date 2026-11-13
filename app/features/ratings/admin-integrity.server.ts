import { createDb } from "../../db/client.server";
import {
  commitAdminOperation, getAdminOperation, prepareAdminOperation,
  type AdminOperationInput,
} from "../operations/admin-operation.server";
import {
  buildIntegrityTransitionBatch, buildVoteInvalidationBatch,
  snapshotIntegrityTransition, snapshotVoteInvalidation,
} from "./integrity.server";

export type IntegrityOperationKind = "INTEGRITY_CASE_TRANSITION" | "VOTE_INVALIDATE";
type Operator = { actorUserId: string; sessionId: string; now: string };
const statusNames = { REVIEWING: "검토 시작", DISMISSED: "사건 해제", CONFIRMED: "조작 확인" };

export async function prepareIntegrityOperation(database: D1Database, input: Operator & {
  kind: IntegrityOperationKind; caseId: string; status?: string; voteEventId?: string; reason: string;
}) {
  const db = createDb(database);
  let payload: unknown;
  let title: string;
  if (input.kind === "INTEGRITY_CASE_TRANSITION") {
    if (input.status !== "REVIEWING" && input.status !== "DISMISSED" && input.status !== "CONFIRMED") throw new Error("INVALID_INTEGRITY_TRANSITION");
    payload = await snapshotIntegrityTransition(db, { ...input, status: input.status });
    title = statusNames[input.status];
  } else {
    payload = await snapshotVoteInvalidation(db, { ...input, integrityCaseId: input.caseId, voteEventId: input.voteEventId ?? "" });
    title = "투표 1건 무효화·재계산 등록";
  }
  const prepared = await prepareAdminOperation(database, { ...input, payload, summary: { title, count: 1 } });
  return { ...prepared, kind: input.kind };
}

export async function readIntegrityOperation(database: D1Database, input: AdminOperationInput & { kind: IntegrityOperationKind }) {
  const operation = await getAdminOperation(database, input);
  const payload = operation.payload as { reason?: string; status?: string; item?: { id: string; status: string }; event?: { id: string } } | null;
  return {
    operationId: operation.id, kind: input.kind, status: operation.status, summary: operation.summary,
    expiresAt: operation.expiresAt, caseId: payload?.item?.id ?? null, previousStatus: payload?.item?.status ?? null,
    nextStatus: payload?.status ?? null, voteEventId: payload?.event?.id ?? null, reason: payload?.reason ?? null,
  };
}

export function commitIntegrityOperation(database: D1Database, input: AdminOperationInput & { kind: IntegrityOperationKind }) {
  return commitAdminOperation(database, input, (operation) => input.kind === "INTEGRITY_CASE_TRANSITION"
    ? buildIntegrityTransitionBatch(database, operation.id, operation.payload, input.actorUserId, input.now)
    : buildVoteInvalidationBatch(database, operation.id, operation.payload, input.actorUserId, input.now));
}
