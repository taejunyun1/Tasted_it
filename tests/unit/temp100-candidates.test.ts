import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, readFileSync, symlinkSync, rmSync, statSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments, validateReferenceUrl, buildTemp100Artifacts, assertPrivateDirectory, writePrivateArtifacts } from "../../scripts/temp100-candidates.mjs";

// All names, addresses, image paths and descriptions below are synthetic; no requests run.
const asOf = "2026-11-14";
function candidate(n: number) {
  return {
    id: `temp100-${String(n).padStart(3, "0")}`, name: `합성 식당 ${n}`, address: `광주광역시 동구 합성${n}로 1`,
    region: "광주 동구", cuisine: "한식", sourceUrl: `https://tour.gwangju.go.kr/synthetic/${n}`, sourceTitle: "합성 공식 출처", checkedAt: asOf,
    summary: "경계 검증에만 쓰는 합성 소개입니다.", existenceStatus: "OFFICIAL_LISTING", operatingStatus: "UNCONFIRMED_WEB_LISTING",
    chainStatus: "NO_CHAIN_SIGNAL", chainNote: "합성 입력이며 실제 영업·체인 확인이 아닙니다.",
    photo: { imageUrl: `https://tour.gwangju.go.kr/synthetic/${n}.jpg`, sourcePageUrl: `https://tour.gwangju.go.kr/synthetic/${n}`, licenseStatus: "LINK_ONLY_UNCONFIRMED", licenseUrl: null, attribution: "확인 필요", depictsPlace: "PAGE_ASSOCIATED" },
    externalEvaluation: { kind: "OFFICIAL_CURATION", provider: "합성 기관", sourceUrl: `https://tour.gwangju.go.kr/synthetic/${n}`, summary: "공식 소개 형식의 합성 입력이며 고객별점이 아닙니다.", score: null, rightsStatus: "LINK_REFERENCE" },
  };
}
function rows() { return Array.from({ length: 100 }, (_, n) => candidate(n + 1)); }
const dirs: string[] = [];
function privateDirectory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "temp100-test-"))); dirs.push(root);
  const operations = join(root, "operations"); mkdirSync(operations, { mode: 0o700 });
  const directory = join(operations, "temp100-seed-20261114-synthetic"); mkdirSync(directory, { mode: 0o700 });
  return { operations, directory };
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("TEMP100 private candidate boundaries", () => {
  it("requires prepare plus one private directory and rejects remote or arbitrary files", () => {
    expect(parseArguments(["--prepare", "--private-dir", "/private/example"])).toBe("/private/example");
    for (const args of [[], ["--remote"], ["--prepare", "--private-dir", "/x", "--remote"], ["--file", "/x"], ["--prepare", "--private-dir", "https://invalid.test/"]]) {
      expect(() => parseArguments(args)).toThrow("TEMP100_ARGUMENTS_INVALID");
    }
  });
  it("rejects unsafe, local and credential-bearing URL references without fetching them", () => {
    expect(validateReferenceUrl("https://tour.gwangju.go.kr/view?id=1")).toBe("https://tour.gwangju.go.kr/view?id=1");
    for (const url of ["javascript:alert(1)", "http://example.test/", "https://user:pass@example.test/", "https://127.0.0.1/", "https://[::1]/", "https://a.local/", "https://localhost/", "https://a.test/?api_key=secret", "https://a.test/?X-Amz-Signature=value"]) {
      expect(() => validateReferenceUrl(url)).toThrow("TEMP100_REFERENCE_URL_INVALID");
    }
  });
  it("requires exactly 100 distinct records and all assigned identifiers", () => {
    expect(() => buildTemp100Artifacts(rows().slice(1), asOf)).toThrow("TEMP100_COUNT_INVALID");
    const duplicate = rows(); duplicate[99] = { ...duplicate[0], id: "temp100-100" };
    expect(() => buildTemp100Artifacts(duplicate, asOf)).toThrow("TEMP100_DUPLICATE_PLACE");
    const duplicateId = rows(); duplicateId[99].id = "temp100-001";
    expect(() => buildTemp100Artifacts(duplicateId, asOf)).toThrow("TEMP100_IDENTIFIERS_INVALID");
  });
  it("rejects injected publication, internal ratings and external numeric ratings", () => {
    for (const extra of [{ status: "PUBLISHED" }, { reviewerId: "synthetic" }, { visitedOn: asOf }, { recommendationScore: 99 }]) {
      const input = rows(); Object.assign(input[0], extra);
      expect(() => buildTemp100Artifacts(input, asOf)).toThrow("TEMP100_FIELDS_INVALID");
    }
    const input = rows(); (input[0].externalEvaluation as unknown as { score: number }).score = 4.9;
    expect(() => buildTemp100Artifacts(input, asOf)).toThrow("TEMP100_EXTERNAL_SCORE_FORBIDDEN");
  });
  it("keeps unverifiable photos blocked and refuses a permission claim without asset evidence", () => {
    const output = buildTemp100Artifacts(rows(), asOf);
    expect(output.aggregate.photoRightsConfirmed).toBe(0);
    expect(output.aggregate.photoRightsBlocked).toBe(100);
    expect(output.importPlan.canWriteDatabase).toBe(false);
    expect(output.dataset.candidates.every((r: { publicationStatus: string }) => r.publicationStatus === "QUARANTINED")).toBe(true);
    const input = rows(); input[0].photo.licenseStatus = "PERMITTED";
    expect(() => buildTemp100Artifacts(input, asOf)).toThrow("TEMP100_PHOTO_EVIDENCE_REQUIRED");
  });
  it("records complete asset evidence as pending review without enabling publication", () => {
    const input = rows(); Object.assign(input[0].photo, { licenseStatus: "PERMITTED", licenseType: "KOGL-1", licenseUrl: "https://www.kogl.or.kr/info/license.do", assetSpecificEvidenceUrl: input[0].sourceUrl, creator: "합성 저작자" });
    const output = buildTemp100Artifacts(input, asOf);
    expect(output.aggregate.photoRightsEvidencePresent).toBe(1);
    expect(output.aggregate.photoRightsConfirmed).toBe(0);
    expect(output.dataset.candidates[0].rightsReviewStatus).toBe("PENDING");
    expect(output.importPlan.canPublish).toBe(false);
  });
  it("produces stable identities and escaped preview with no automatic remote images or scripts", () => {
    const input = rows(); input[0].summary = '<script>alert("synthetic")</script>';
    const a = buildTemp100Artifacts(input, asOf); const b = buildTemp100Artifacts([...input].reverse(), asOf);
    expect(a.aggregate.datasetSha256).toBe(b.aggregate.datasetSha256);
    expect(a.previewHtml).toContain("&lt;script&gt;");
    expect(a.previewHtml).not.toContain("<script>");
    expect(a.previewHtml).not.toContain("<img");
    expect(a.previewHtml).toContain("img-src 'none'");
    expect(a.importPlan.records[0].idempotencyKey).toBe(b.importPlan.records[0].idempotencyKey);
  });
  it("rejects excluded chains, closed sources and future dates without claiming readiness", () => {
    for (const change of [{ chainStatus: "EXCLUDED" }, { operatingStatus: "CLOSED" }, { checkedAt: "2027-01-01" }, { region: "서울" }]) {
      const input = rows(); Object.assign(input[0], change);
      expect(() => buildTemp100Artifacts(input, asOf)).toThrow("TEMP100_CANDIDATE_INVALID");
    }
  });
  it("requires an owned private directory, rejects symlinks and preserves existing artifacts", () => {
    const { operations, directory } = privateDirectory();
    expect(assertPrivateDirectory(directory, operations)).toBe(directory);
    chmodSync(directory, 0o755); expect(() => assertPrivateDirectory(directory, operations)).toThrow("TEMP100_PRIVATE_DIRECTORY_REQUIRED"); chmodSync(directory, 0o700);
    const link = join(operations, "temp100-seed-20261114-link"); symlinkSync(directory, link);
    expect(() => assertPrivateDirectory(link, operations)).toThrow("TEMP100_PRIVATE_DIRECTORY_REQUIRED");
    const output = buildTemp100Artifacts(rows(), asOf); writePrivateArtifacts(directory, output); writePrivateArtifacts(directory, output);
    expect(statSync(join(directory, "candidates.json")).mode & 0o777).toBe(0o600);
    const before = readFileSync(join(directory, "candidates.json"), "utf8");
    writeFileSync(join(directory, "aggregate.json"), "preserved original", { mode: 0o600 });
    expect(() => writePrivateArtifacts(directory, output)).toThrow("TEMP100_ARTIFACT_CONFLICT");
    expect(readFileSync(join(directory, "aggregate.json"), "utf8")).toBe("preserved original");
    expect(readFileSync(join(directory, "candidates.json"), "utf8")).toBe(before);
  });
});
