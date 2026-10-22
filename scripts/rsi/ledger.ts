import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { z } from "zod";
import {
  assertTransition, deriveIncidentKey, deriveKst, deriveObservationFingerprint,
  parseEvidenceReference, parseLineage, parseObservation,
  type RsiLineage, type RsiObservation, type RsiStatus, type RsiTransition,
} from "./contracts";

// Local synthetic storage, not a provider broker. The controller owns the clock,
// receipt provenance and trusted head checkpoint. Hashes detect changes against
// that checkpoint; they do not authenticate a writer or an execution receipt.
const MAX_EVENT_BYTES = 262_144;
const MAX_REVISIONS = 10_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.uuid().transform((v) => v.toLowerCase());
const units = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const utc = z.string().refine((v) => { try { deriveKst(v); return true; } catch { return false; } });
const configSchema = z.strictObject({
  schemaVersion: z.literal(1), environment: z.literal("LOCAL_SYNTHETIC"), campaignId: id,
  currencyUnit: z.literal("MICRO_USD"),
  limits: z.strictObject({ incident: units.positive(), campaign: units.positive(), day: units.positive(), month: units.positive() }),
});
const reserveSchema = z.strictObject({
  requestId: id, maximumCostUnits: units.positive(),
  observation: z.unknown().transform(parseObservation), lineage: z.unknown().transform(parseLineage),
});
const receiptSchema = z.strictObject({
  runId: id, receiptId: id, kind: z.enum(["CONFIRMED", "AMBIGUOUS"]),
  chargedUnits: units.nullable(), receiptDigest: digest,
}).refine((v) => v.kind === "AMBIGUOUS" ? v.chargedUnits === null : v.chargedUnits !== null);
const transitionSchema = z.strictObject({ runId: id, transition: z.unknown().transform(assertTransition) });
const closureIdentity = {
  incidentKey: digest, incidentEpoch: z.number().int().min(1).max(1_000_000),
};
const closureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...closureIdentity, kind: z.literal("RECOVERY_CONFIRMED"),
    evidence: z.unknown().transform(parseEvidenceReference),
  }).refine((v) => v.evidence.kind === "LIVE_PROBE" && v.evidence.verdict === "PASS"),
  z.strictObject({
    ...closureIdentity, kind: z.literal("OPERATOR_CLOSED"),
    authorization: z.unknown().transform(parseEvidenceReference),
    evidence: z.unknown().transform(parseEvidenceReference),
  }).refine((v) => v.authorization.kind === "AUTHORIZATION" && v.authorization.verdict === "PASS"
    && v.evidence.kind === "OUTCOME" && v.evidence.verdict === "PASS"
    && v.authorization.evidenceId !== v.evidence.evidenceId),
]);
// OPERATOR_CLOSED receipts attest to the authorized closure action, not recovery.
// As with other evidence, their provenance must be supplied by the trusted caller.
const eventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("CREATE"), atUtc: utc, data: configSchema }),
  z.strictObject({ type: z.literal("RESERVE"), atUtc: utc, data: reserveSchema }),
  z.strictObject({ type: z.literal("SETTLE"), atUtc: utc, data: receiptSchema }),
  z.strictObject({ type: z.literal("TRANSITION"), atUtc: utc, data: transitionSchema }),
  z.strictObject({ type: z.literal("CLOSE"), atUtc: utc, data: closureSchema }),
]);
const checkpointSchema = z.strictObject({ revision: z.number().int().min(0).max(MAX_REVISIONS - 1), hash: digest });
const revisionSchema = z.strictObject({ schemaVersion: z.literal(1), revision: checkpointSchema.shape.revision,
  parentHash: digest.nullable(), event: eventSchema, hash: digest });
export type RsiLedgerCheckpoint = z.infer<typeof checkpointSchema>;
export type RsiLedgerConfig = z.infer<typeof configSchema>;
type Event = z.infer<typeof eventSchema>;
type Receipt = z.infer<typeof receiptSchema>;
type Reservation = z.infer<typeof reserveSchema>;
export interface RsiLedgerRun extends Reservation {
  status: RsiStatus;
  reservedAtUtc: string;
  day: string;
  month: string;
  transitions: RsiTransition[];
  settlement: (Receipt & { consumedUnits: number; atUtc: string; day: string; month: string }) | null;
}
export interface RsiLedgerState {
  config: RsiLedgerConfig;
  lastAtUtc: string;
  runs: RsiLedgerRun[];
  aliases: (Reservation & { targetRunId: string })[];
  closures: (z.infer<typeof closureSchema> & { atUtc: string })[];
}
export interface RsiReservationResult { authorized: boolean; runId: string; requestId: string; maximumCostUnits: number }
const terminalStatuses: readonly RsiStatus[] = ["REJECTED", "BLOCKED", "INCONCLUSIVE", "NO_CHANGE", "LIVE_VERIFIED"];
function fail(code = "RSI_LEDGER_INVALID"): never { throw new Error(code); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  try { return schema.parse(input); } catch { return fail(); }
}
async function boundary<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    const codes = ["RSI_LEDGER_INVALID", "RSI_LEDGER_UNAVAILABLE", "RSI_LEDGER_STALE", "RSI_LEDGER_BUDGET"];
    if (error instanceof Error && codes.includes(error.message)) throw error;
    throw new Error("RSI_LEDGER_UNAVAILABLE");
  }
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function period(time: string) { const kst = deriveKst(time); return { day: kst.slice(0, 10), month: kst.slice(0, 7) }; }
function add(a: number, b: number): number { const sum = a + b; if (!Number.isSafeInteger(sum)) fail("RSI_LEDGER_BUDGET"); return sum; }
function result(run: RsiLedgerRun, authorized: boolean): RsiReservationResult {
  return { authorized, runId: run.lineage.runId, requestId: run.requestId, maximumCostUnits: run.maximumCostUnits };
}
function reservationOf(run: RsiLedgerRun): Reservation {
  return { requestId: run.requestId, maximumCostUnits: run.maximumCostUnits, observation: run.observation, lineage: run.lineage };
}
function checkObservation(data: { observation: RsiObservation; lineage: RsiLineage }, atUtc: string) {
  if (data.lineage.incidentKey !== deriveIncidentKey(data.observation.incident)
    || data.lineage.eventFingerprint !== deriveObservationFingerprint(data.observation)
    || data.lineage.baseAppSha !== data.observation.incident.baseAppSha
    || data.observation.observedAtUtc > atUtc) fail();
}
function reserve(state: RsiLedgerState, data: Reservation, atUtc: string): RsiReservationResult {
  checkObservation(data, atUtc);
  const duplicate = state.runs.find((r) => r.requestId === data.requestId || r.lineage.runId === data.lineage.runId);
  if (duplicate) {
    if (!same(reservationOf(duplicate), data)) fail();
    return result(duplicate, false);
  }
  const alias = state.aliases.find((r) => r.requestId === data.requestId || r.lineage.runId === data.lineage.runId);
  if (alias) {
    const { targetRunId, ...original } = alias;
    if (!same(original, data)) fail();
    const target = state.runs.find((r) => r.lineage.runId === targetRunId);
    if (!target) fail();
    return result(target, false);
  }
  const related = state.runs.filter((r) => r.lineage.incidentKey === data.lineage.incidentKey);
  const epochRuns = related.filter((r) => r.lineage.incidentEpoch === data.lineage.incidentEpoch);
  if (data.lineage.attempt === 1 && epochRuns.length > 0) {
    state.aliases.push({ ...data, targetRunId: epochRuns[0].lineage.runId });
    return result(epochRuns[0], false);
  }
  const latest = related.at(-1);
  if (data.lineage.attempt === 1) {
    if (!latest ? data.lineage.incidentEpoch !== 1 : data.lineage.incidentEpoch !== latest.lineage.incidentEpoch + 1) fail();
    if (latest) {
      const closed = state.closures.find((c) => c.incidentKey === data.lineage.incidentKey && c.incidentEpoch === latest.lineage.incidentEpoch);
      if (!closed || data.observation.observedAtUtc <= closed.atUtc) fail();
    }
  } else {
    const parent = epochRuns.at(-1);
    if (!parent || data.lineage.parentRunId !== parent.lineage.runId || data.lineage.attempt !== parent.lineage.attempt + 1
      || data.lineage.parentAgentHash !== parent.lineage.candidateAgentHash
      || !terminalStatuses.includes(parent.status) || !parent.settlement
      || state.closures.some((c) => c.incidentKey === data.lineage.incidentKey && c.incidentEpoch === data.lineage.incidentEpoch)) fail();
  }
  const current = period(atUtc);
  const totals = { incident: 0, campaign: 0, day: 0, month: 0 };
  for (const run of state.runs) {
    const cost = run.settlement?.consumedUnits ?? run.maximumCostUnits;
    totals.campaign = add(totals.campaign, cost);
    if (run.lineage.incidentKey === data.lineage.incidentKey) totals.incident = add(totals.incident, cost);
    // Pending exposure carries into EVERY current accounting period. Confirmed
    // cost counts in both reservation and settlement periods (conservative).
    if (!run.settlement || run.day === current.day || run.settlement.day === current.day) totals.day = add(totals.day, cost);
    if (!run.settlement || run.month === current.month || run.settlement.month === current.month) totals.month = add(totals.month, cost);
  }
  for (const key of ["incident", "campaign", "day", "month"] as const) {
    if (add(totals[key], data.maximumCostUnits) > state.config.limits[key]) fail("RSI_LEDGER_BUDGET");
  }
  const run: RsiLedgerRun = { ...data, status: "OBSERVED", reservedAtUtc: atUtc, ...current, transitions: [], settlement: null };
  state.runs.push(run);
  return result(run, true);
}
function apply(state: RsiLedgerState, event: Exclude<Event, { type: "CREATE" }>): RsiReservationResult | boolean {
  if (event.atUtc < state.lastAtUtc) fail();
  let changed = true;
  switch (event.type) {
    case "RESERVE": {
      const previousAliases = state.aliases.length;
      const outcome = reserve(state, event.data, event.atUtc);
      if (outcome.authorized || state.aliases.length !== previousAliases) state.lastAtUtc = event.atUtc;
      return outcome;
    }
    case "SETTLE": {
      const data = event.data;
      const run = state.runs.find((r) => r.lineage.runId === data.runId);
      if (!run || state.runs.some((r) => r.lineage.runId !== data.runId && r.settlement?.receiptId === data.receiptId)) fail();
      if (run.settlement) {
        const s = run.settlement;
        if (!same({ runId: s.runId, receiptId: s.receiptId, kind: s.kind, chargedUnits: s.chargedUnits, receiptDigest: s.receiptDigest }, data)) fail();
        changed = false;
      } else {
        const consumedUnits = data.kind === "AMBIGUOUS" ? run.maximumCostUnits : data.chargedUnits!;
        if (consumedUnits > run.maximumCostUnits) fail();
        run.settlement = { ...data, consumedUnits, atUtc: event.atUtc, ...period(event.atUtc) };
      }
      break;
    }
    case "TRANSITION": {
      const run = state.runs.find((r) => r.lineage.runId === event.data.runId);
      if (!run || run.status !== event.data.transition.from) fail();
      run.transitions.push(event.data.transition); run.status = event.data.transition.to;
      break;
    }
    case "CLOSE": {
      const data = event.data;
      const runs = state.runs.filter((r) => r.lineage.incidentKey === data.incidentKey && r.lineage.incidentEpoch === data.incidentEpoch);
      if (!runs.length || runs.some((r) => !terminalStatuses.includes(r.status) || !r.settlement)) fail();
      const previous = state.closures.find((c) => c.incidentKey === data.incidentKey && c.incidentEpoch === data.incidentEpoch);
      if (previous) {
        const { atUtc: _closedAt, ...original } = previous;
        if (!same(original, data)) fail();
        changed = false;
      } else state.closures.push({ ...data, atUtc: event.atUtc });
      break;
    }
  }
  if (changed) state.lastAtUtc = event.atUtc;
  return changed;
}
function name(revision: number): string { return `${String(revision).padStart(5, "0")}.json`; }
async function safeDirectory(path: string) {
  if (!isAbsolute(path) || path !== resolve(path) || path.split("/").some((s) => s === "." || s === "..")) fail();
  let current = parsePath(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail();
  }
  return lstat(path);
}
async function syncDirectory(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

export class LocalRsiLedger {
  private constructor(private readonly path: string, private head: RsiLedgerCheckpoint, private readonly device: number, private readonly inode: number) {}
  get checkpoint(): RsiLedgerCheckpoint { return { ...this.head }; }

  static async create(path: string, config: unknown, nowUtc: unknown): Promise<LocalRsiLedger> {
    return boundary(async () => {
      const event = parse(eventSchema, { type: "CREATE", atUtc: nowUtc, data: config });
      if (!isAbsolute(path) || path !== resolve(path)) fail();
      await safeDirectory(dirname(path));
      // mkdir without recursive is deliberate: an existing/lost store is never
      // silently adopted or reset, including a concurrent create.
      await mkdir(path, { mode: 0o700 });
      await syncDirectory(dirname(path));
      const stat = await safeDirectory(path);
      const ledger = new LocalRsiLedger(path, { revision: 0, hash: "0".repeat(64) }, stat.dev, stat.ino);
      await mkdir(join(path, ".writer-lock"), { mode: 0o700 });
      await ledger.writeRevision(event, null, 0);
      await rmdir(join(path, ".writer-lock"));
      await syncDirectory(path);
      return ledger;
    });
  }

  static async open(path: string, trustedCheckpoint: unknown): Promise<LocalRsiLedger> {
    return boundary(async () => {
      const checkpoint = parse(checkpointSchema, trustedCheckpoint);
      const stat = await safeDirectory(path);
      const ledger = new LocalRsiLedger(path, checkpoint, stat.dev, stat.ino);
      await ledger.load(false);
      return ledger;
    });
  }

  async read(): Promise<RsiLedgerState> { return boundary(async () => structuredClone(await this.load(false))); }
  async reserve(input: unknown, nowUtc: unknown): Promise<RsiReservationResult> {
    return this.transaction({ type: "RESERVE", atUtc: nowUtc, data: input }) as Promise<RsiReservationResult>;
  }
  async settle(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "SETTLE", atUtc: nowUtc, data: input }); }
  async transition(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "TRANSITION", atUtc: nowUtc, data: input }); }
  async closeIncident(input: unknown, nowUtc: unknown): Promise<void> { await this.transaction({ type: "CLOSE", atUtc: nowUtc, data: input }); }

  private async checkRoot() {
    const stat = await safeDirectory(this.path);
    if (stat.dev !== this.device || stat.ino !== this.inode || (stat.mode & 0o077) !== 0) fail();
  }
  private async load(locked: boolean): Promise<RsiLedgerState> {
    await this.checkRoot();
    const entries = await readdir(this.path);
    const files = entries.filter((entry) => !(locked && entry === ".writer-lock")).sort();
    if (!files.length || files.length > MAX_REVISIONS || files.some((file, index) => file !== name(index))) fail();
    let state: RsiLedgerState | undefined;
    let previousHash: string | null = null;
    for (let index = 0; index < files.length; index++) {
      const handle = await open(join(this.path, files[index]), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let raw: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_EVENT_BYTES) fail();
        raw = await handle.readFile("utf8");
        if (Buffer.byteLength(raw) > MAX_EVENT_BYTES) fail();
      } finally { await handle.close(); }
      const row = parse(revisionSchema, JSON.parse(raw));
      // Exact bytes prohibit duplicate JSON keys, ignored fields and normalized
      // alternate representations that would otherwise evade parsed hashes.
      if (raw !== JSON.stringify(row)) fail();
      const payload = { schemaVersion: row.schemaVersion, revision: row.revision, parentHash: row.parentHash, event: row.event };
      if (row.revision !== index || row.parentHash !== previousHash || hash(payload) !== row.hash) fail();
      if (index === 0) {
        if (row.event.type !== "CREATE") fail();
        state = { config: row.event.data, lastAtUtc: row.event.atUtc, runs: [], aliases: [], closures: [] };
      } else {
        if (!state || row.event.type === "CREATE") fail();
        const previousAliases = state.aliases.length;
        const applied = apply(state, row.event);
        if (applied === false || (typeof applied === "object" && !applied.authorized && state.aliases.length === previousAliases)) fail();
      }
      previousHash = row.hash;
    }
    await this.checkRoot();
    if (files.length - 1 !== this.head.revision || previousHash !== this.head.hash) fail("RSI_LEDGER_STALE");
    if (!state) fail();
    return state;
  }

  private async writeRevision(event: Event, parentHash: string | null, revision: number) {
    if (revision >= MAX_REVISIONS) fail();
    const payload = { schemaVersion: 1 as const, revision, parentHash, event };
    const row = { ...payload, hash: hash(payload) };
    const bytes = JSON.stringify(row);
    if (Buffer.byteLength(bytes) > MAX_EVENT_BYTES) fail();
    await this.checkRoot();
    const pending = join(this.path, ".pending");
    const handle = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await this.checkRoot();
    await rename(pending, join(this.path, name(revision)));
    await syncDirectory(this.path);
    this.head = { revision, hash: row.hash };
  }

  private async transaction(input: unknown): Promise<RsiReservationResult | boolean> {
    return boundary(async () => {
      const event = parse(eventSchema, input);
      if (event.type === "CREATE") fail();
      await this.checkRoot();
      const lock = join(this.path, ".writer-lock");
      await mkdir(lock, { mode: 0o700 });
      let writing = false;
      try {
        const state = await this.load(true);
        const previousAliases = state.aliases.length;
        const outcome = apply(state, event);
        if (outcome !== false && !(typeof outcome === "object" && !outcome.authorized && state.aliases.length === previousAliases)) {
          writing = true;
          await this.writeRevision(event, this.head.hash, this.head.revision + 1);
          writing = false;
        }
        await rmdir(lock); await syncDirectory(this.path);
        return outcome;
      } catch (error) {
        // Validation/stale failures have no partial write. An uncertain write
        // keeps the lock and any pending file: recovery is explicit, never stolen.
        if (!writing) { await rmdir(lock); await syncDirectory(this.path); }
        throw error;
      }
    });
  }
}
