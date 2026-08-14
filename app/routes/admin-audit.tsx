import { env } from "cloudflare:workers";

import type { Route } from "./+types/admin-audit";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { runRecordAudit } from "../features/audit/record-audit.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return runRecordAudit(createDb(env.DB), {
    now: new Date().toISOString(),
    sourceCommit: "runtime-unversioned",
  });
}

export function meta() {
  return [{ title: "통합 기록 감사 — Re:Taste Admin" }];
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
  return (
    <main id="main" className="admin-rating-shell audit-shell">
      <header>
        <p className="eyebrow">ADMIN / AUDIT</p>
        <h1>통합 기록 감사</h1>
        <p>읽기 전용 기준선입니다. 결과는 자동으로 수정되지 않습니다.</p>
        <small>감사 버전 {loaderData.version} · 기준 {loaderData.generatedAt}</small>
      </header>

      <section className="audit-summary" aria-label="감사 요약">
        {Object.entries(loaderData.summary).map(([severity, count]) => (
          <article key={severity}>
            <span>{severity}</span>
            <strong>{count}</strong>
          </article>
        ))}
      </section>

      <section className="admin-rating-section" aria-label="감사 발견">
        <h2>발견 사항</h2>
        {loaderData.queryCapsReached.length ? (
          <p>행 상한 도달: {loaderData.queryCapsReached.join(", ")} — 해당 결과는 불완전할 수 있습니다.</p>
        ) : null}
        {loaderData.findings.length ? loaderData.findings.map((finding) => (
          <article className="audit-finding" key={finding.id}>
            <strong>{finding.severity} · {finding.ruleId}</strong>
            <h3>{finding.title}</h3>
            <p>{finding.impact}</p>
            <small>표본 {finding.sampleIds.join(", ")} · {finding.count}건{finding.isIncomplete ? " · INCOMPLETE" : ""}</small>
          </article>
        )) : <p>현재 범위에서 발견된 정합성 이슈가 없습니다.</p>}
      </section>
    </main>
  );
}
