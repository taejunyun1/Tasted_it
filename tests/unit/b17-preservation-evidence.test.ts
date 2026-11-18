import { describe, expect, it } from "vitest";
import {
  B17_PRESERVATION_COLUMNS, B17_PRESERVATION_LIMITS,
  buildB17PreservationCatalogQuery, planB17PreservationCapture,
  collectB17PreservationSnapshot, compareB17PreservationSnapshots, describeB17PreservationCapture, verifyB17PreservationSources,
} from "../../scripts/b17-preservation-evidence.mjs";

describe("complete B17 preservation evidence", () => {
  it("rejects hand-authored or incomplete catalogues", () => {
    expect(Object.keys(B17_PRESERVATION_COLUMNS)).toHaveLength(82);
    expect(buildB17PreservationCatalogQuery().sqlStatementCount).toBe(1);
    expect(() => planB17PreservationCapture({ phase: "before", catalog: [] })).toThrow("CATALOG");
    expect(() => planB17PreservationCapture({ phase: "before", catalog: { complete: true } })).toThrow("CATALOG");
  });

  it("rejects hand-authored completion rather than inferring preservation", () => {
    expect(() => collectB17PreservationSnapshot({ complete: true }, {})).toThrow();
    expect(() => compareB17PreservationSnapshots({ complete: true }, { complete: true })).toThrow();
    expect(B17_PRESERVATION_LIMITS.maxTableRows).toBe(10000);
  });

  it("budgets capture without pretending a runtime catalogue was verified", () => {
    const description = describeB17PreservationCapture();
    expect(description.requiresRuntimeCatalog).toBe(true);
    expect(description.tableCount).toBe(82);
    expect(description.columnCount).toBe(853);
    expect(description.perPhase.captureD1Commands + description.perPhase.catalogD1Commands).toBe(8);
    expect(description.perPhase.captureSqlStatements + description.perPhase.catalogSqlStatements).toBe(8);
    expect(description.perPhase.queries.every((q: {sql?: string}) => q.sql === undefined)).toBe(true);
  });

  it("binds the catalogue to the exact committed migration sources", async () => {
    await expect(verifyB17PreservationSources(process.cwd())).resolves.toMatchObject({ ok: true, migrationCount: 60 });
  });
});
