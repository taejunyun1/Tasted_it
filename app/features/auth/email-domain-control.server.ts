import { z } from "zod";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";
import { emailDomainSchema, inspectEmailDomain, repairEmailDomain } from "./email-domain.server";

type Operator = { actorUserId: string; sessionId: string; now: string };
type Input = Operator & { targetDomain: string; apiKey: string; fetcher?: typeof fetch };
type DomainState = { target_domain: string; revision: number; provider_domain_id: string | null; provider_status: string | null; observed_at: string | null };
const active = "('REQUESTED','DISPATCHED','CREATED','UNKNOWN','ACCEPTED')";
const snapshot = z.object({ targetDomain: emailDomainSchema, revision: z.number().int().nonnegative(),
  intent: z.enum(["create", "verify"]), providerDomainId: z.uuid().nullable(), observedAt: z.iso.datetime() });

function authSql(recent = false) {
  return `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.role='ADMIN'
    AND u.email NOT LIKE 'withdrawn.%@invalid.local' AND u.email_verified_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id AND r.lifted_at IS NULL
      AND r.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ${recent ? "AND EXISTS(SELECT 1 FROM admin_session_assurances a WHERE a.session_id=s.id AND a.actor_user_id=u.id AND a.verified_at<=? AND a.expires_at>?)" : ""}`;
}
function auth(database: D1Database, input: Operator, recent = false) {
  const now = z.iso.datetime().parse(input.now);
  return database.prepare(authSql(recent))
    .bind(input.sessionId, input.actorUserId, now, ...(recent ? [now, now] : []));
}
async function assertAuth(database: D1Database, input: Operator) {
  if (!await auth(database, input).first()) throw new Error("ADMIN_REQUIRED");
}
function state(database: D1Database, target: string) {
  return database.prepare("SELECT * FROM email_domain_state WHERE target_domain=?").bind(target).first<DomainState>();
}

/** Stored observations only: rendering this view never calls the provider. */
export async function readEmailDomainControl(database: D1Database, targetDomain: string) {
  const target = emailDomainSchema.parse(targetDomain), current = await state(database, target);
  const actions = await database.prepare(`SELECT operation_id,intent,state,requested_at,dispatched_at,observed_at
    FROM email_domain_actions WHERE target_domain=? ORDER BY requested_at DESC,operation_id DESC LIMIT 20`)
    .bind(target).all<{ operation_id: string; intent: string; state: string; requested_at: string; dispatched_at: string | null; observed_at: string | null }>();
  return { observation: current?.observed_at ? { revision: current.revision, status: current.provider_status,
    domainPresent: current.provider_domain_id !== null, observedAt: current.observed_at } : null,
    actions: actions.results.map((a) => ({ operationId: a.operation_id, intent: a.intent,
      state: a.state === "DISPATCHED" ? "UNKNOWN" : a.state, requestedAt: a.requested_at, observedAt: a.observed_at })),
    mutationBlocked: actions.results.some((a) => ["REQUESTED", "DISPATCHED", "CREATED", "UNKNOWN", "ACCEPTED"].includes(a.state)) };
}

/** At most a list GET and one exact-domain GET; no automatic retries. */
export async function refreshEmailDomain(database: D1Database, input: Input) {
  const target = emailDomainSchema.parse(input.targetDomain); await assertAuth(database, input);
  await database.prepare("INSERT OR IGNORE INTO email_domain_state(target_domain) VALUES(?)").bind(target).run();
  const before = (await state(database, target))!;
  const result = await inspectEmailDomain({ apiKey: input.apiKey, targetDomain: target, fetcher: input.fetcher });
  const guard = crypto.randomUUID();
  const status = result.domain?.status ?? "ABSENT", providerId = result.domain?.id ?? null;
  await database.batch([
    database.prepare(`INSERT INTO email_domain_guards(id,passed) SELECT ?,CASE WHEN
      EXISTS(SELECT 1 FROM email_domain_state WHERE target_domain=? AND revision=?) AND EXISTS(${authSql()}) THEN 1 ELSE 0 END`)
      .bind(guard, target, before.revision, input.sessionId, input.actorUserId, input.now),
    database.prepare("UPDATE email_domain_state SET revision=revision+1,provider_domain_id=?,provider_status=?,observed_at=? WHERE target_domain=?")
      .bind(providerId, status, input.now, target),
    database.prepare(`UPDATE email_domain_actions SET state=CASE
      WHEN intent='create' AND ? IS NOT NULL AND (provider_domain_id IS NULL OR provider_domain_id=?) THEN 'OBSERVED_PRESENT'
      WHEN intent='verify' AND provider_domain_id=? AND ?='verified' THEN 'OBSERVED_VERIFIED'
      WHEN intent='verify' AND provider_domain_id=? AND ?='failed' THEN 'OBSERVED_FAILED' ELSE state END,
      observed_at=? WHERE target_domain=? AND state IN ('DISPATCHED','CREATED','UNKNOWN','ACCEPTED')`)
      .bind(providerId, providerId, providerId, status, providerId, status, input.now, target),
    database.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES(?,?,'EMAIL_DOMAIN_OBSERVED','EMAIL_DOMAIN',?,?,?)")
      .bind(crypto.randomUUID(), input.actorUserId, target, JSON.stringify({ status }), input.now),
    database.prepare("DELETE FROM email_domain_guards WHERE id=?").bind(guard),
  ]);
  return readEmailDomainControl(database, target);
}

export async function prepareEmailDomainAction(database: D1Database, input: Operator & { targetDomain: string; intent: "create" | "verify" }) {
  await assertAuth(database, input);
  const target = emailDomainSchema.parse(input.targetDomain), intent = z.enum(["create", "verify"]).parse(input.intent);
  const current = await state(database, target);
  if (!current?.observed_at || Date.parse(input.now) - Date.parse(current.observed_at) > 300_000 || current.observed_at > input.now)
    throw new Error("EMAIL_DOMAIN_OBSERVATION_REQUIRED");
  if (await database.prepare(`SELECT 1 FROM email_domain_actions WHERE target_domain=? AND state IN ${active}`).bind(target).first())
    throw new Error("EMAIL_DOMAIN_RESULT_PENDING");
  if (intent === "create" ? current.provider_domain_id !== null || current.provider_status !== "ABSENT"
    : !current.provider_domain_id || current.provider_status === "verified") throw new Error("EMAIL_DOMAIN_ACTION_UNAVAILABLE");
  const payload = snapshot.parse({ targetDomain: target, intent, revision: current.revision,
    providerDomainId: current.provider_domain_id, observedAt: current.observed_at });
  return prepareAdminOperation(database, { ...input, kind: "EMAIL_DOMAIN_CONTROL", payload,
    summary: { title: intent === "create" ? "지정 메일 도메인 생성" : "지정 메일 도메인 검증 요청", count: 1 } });
}

export async function readEmailDomainAction(database: D1Database, input: Operator & { operationId: string; targetDomain: string }) {
  const operation = await getVerifiedAdminOperation(database, { ...input, kind: "EMAIL_DOMAIN_CONTROL" });
  const payload = snapshot.parse(operation.status === "COMMITTED" ? operation.result : operation.payload);
  if (payload.targetDomain !== input.targetDomain) throw new Error("EMAIL_DOMAIN_TARGET_CHANGED");
  return { operationId: operation.id, status: operation.status, intent: payload.intent, targetDomain: payload.targetDomain, expiresAt: operation.expiresAt };
}

export async function commitEmailDomainAction(database: D1Database, input: Input & { operationId: string }) {
  const target = emailDomainSchema.parse(input.targetDomain);
  await readEmailDomainAction(database, input);
  const accepted = await commitAdminOperation(database, { ...input, kind: "EMAIL_DOMAIN_CONTROL" }, (operation) => {
    const p = snapshot.parse(operation.payload);
    if (p.targetDomain !== target) throw new Error("EMAIL_DOMAIN_TARGET_CHANGED");
    return {
      checks: [database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
        SELECT ?,'email_domain_caller',CASE WHEN EXISTS(${authSql(true)}) THEN 1 ELSE 0 END`)
        .bind(operation.id, input.sessionId, input.actorUserId, input.now, input.now, input.now),
        database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
        SELECT ?,'email_domain_observation',CASE WHEN EXISTS(SELECT 1 FROM email_domain_state
          WHERE target_domain=? AND revision=? AND provider_domain_id IS ? AND observed_at=? AND observed_at<=? AND observed_at>?)
          AND NOT EXISTS(SELECT 1 FROM email_domain_actions WHERE target_domain=? AND state IN ${active}) THEN 1 ELSE 0 END`)
        .bind(operation.id, target, p.revision, p.providerDomainId, p.observedAt, input.now,
          new Date(Date.parse(input.now) - 300_000).toISOString(), target)],
      statements: [
        database.prepare("INSERT INTO email_domain_actions(operation_id,target_domain,intent,provider_domain_id,state,requested_at,dispatched_at) VALUES(?,?,?,?,'DISPATCHED',?,?)")
          .bind(operation.id, target, p.intent, p.providerDomainId, input.now, input.now),
        database.prepare("UPDATE email_domain_state SET revision=revision+1,observed_at=NULL WHERE target_domain=?").bind(target),
      ], result: p,
    };
  });
  const p = snapshot.parse(accepted.result);
  // B02 atomically grants one dispatch. Only its winning response may send.
  // A lost commit response remains UNKNOWN, including when no request was sent.
  if (!accepted.replayed) {
    let outcome = "UNKNOWN", createdId: string | null = null;
    try {
      const result = await repairEmailDomain({ apiKey: input.apiKey, targetDomain: target, intent: p.intent,
        ...(p.providerDomainId ? { domainId: p.providerDomainId } : {}), fetcher: input.fetcher });
      if (result.domain) createdId = result.domain.id;
      outcome = p.intent === "create" ? "CREATED" : "ACCEPTED";
    } catch { /* Preserve result uncertainty, including timeouts and malformed success bodies. */ }
    try {
      await database.batch([
        database.prepare("UPDATE email_domain_actions SET state=?,provider_domain_id=COALESCE(?,provider_domain_id),observed_at=? WHERE operation_id=? AND state='DISPATCHED'")
          .bind(outcome, createdId, input.now, accepted.operationId),
        database.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,after_state,created_at) VALUES(?,?,'EMAIL_DOMAIN_REQUEST_RESULT','ADMIN_OPERATION',?,?,?)")
          .bind(crypto.randomUUID(), input.actorUserId, accepted.operationId, JSON.stringify({ intent: p.intent, state: outcome }), input.now),
      ]);
    } catch { /* DISPATCHED is displayed as UNKNOWN until a read-only observation reconciles it. */ }
  }
  return { operationId: accepted.operationId, ...await readEmailDomainControl(database, target) };
}
