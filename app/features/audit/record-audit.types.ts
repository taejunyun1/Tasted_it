export const AUDIT_VERSION = "record-audit-v1" as const;

export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type AuditArea =
  | "PLACE"
  | "RECOMMENDATION"
  | "RATING"
  | "REVIEWER"
  | "ADMIN_ACTION"
  | "RETENTION"
  | "OPERATIONS";

export type AuditFinding = {
  id: string;
  area: AuditArea;
  severity: AuditSeverity;
  ruleId: string;
  title: string;
  impact: string;
  sampleIds: string[];
  count: number;
  isIncomplete: boolean;
};

export type RecordAuditReport = {
  version: typeof AUDIT_VERSION;
  generatedAt: string;
  dataWindow: { from: string; to: string };
  sourceCommit: string;
  queryCapsReached: string[];
  findings: AuditFinding[];
  summary: Record<AuditSeverity, number>;
};
