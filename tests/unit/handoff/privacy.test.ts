import { describe, expect, it } from "vitest";
import { HandoffPrivacyService } from "../../../src/core/handoff/HandoffPrivacyService";
import {
  HandoffPrivacyReportSchema,
  type HandoffPrivacyReport,
} from "../../../src/shared/contracts/handoff";

function scanWith(text: string): HandoffPrivacyReport {
  return new HandoffPrivacyService().scan({ continuity: text, evidence: text });
}

describe("HandoffPrivacyService — secret redaction", () => {
  it("excludes raw GitHub access tokens", () => {
    const report = scanWith("token ghp_abcdefghijklmnopqrstuvwxyz0123456789 secret");
    expect(report.findings.some((f) => f.category === "access-token")).toBe(true);
  });

  it("excludes private key blocks", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
    const report = scanWith(key);
    expect(report.findings.some((f) => f.category === "private-key")).toBe(true);
  });

  it("excludes connection strings with credentials", () => {
    const report = scanWith("postgres://admin:pass@db.example.com:5432/app");
    expect(report.findings.some((f) => f.category === "connection-string")).toBe(true);
  });

  it("excludes authorization headers", () => {
    const report = scanWith("authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789");
    expect(report.findings.some((f) => f.category === "authorization-header")).toBe(true);
  });

  it("excludes absolute user-home paths", () => {
    const report = scanWith("see /Users/sudheer/projects/keystone/src/core/workflow.ts");
    expect(report.findings.some((f) => f.category === "personal-absolute-path")).toBe(true);
  });

  it("masks the value in the preview (never shows the whole secret)", () => {
    const report = scanWith("token ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    const finding = report.findings.find((f) => f.category === "access-token")!;
    expect(finding.maskedPreview).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(finding.maskedPreview.length).toBeLessThan(30);
  });

  it("blocks export for high-confidence critical findings", () => {
    const service = new HandoffPrivacyService();
    const report = service.scan({ continuity: "postgres://admin:pass@db.example.com:5432/app" });
    expect(service.blocksExport(report)).toBe(true);
  });

  it("does not allow overriding a high-confidence credential finding as false positive", () => {
    const service = new HandoffPrivacyService();
    const report = service.scan({ continuity: "postgres://admin:pass@db.example.com:5432/app" });
    const finding = report.findings[0]!;
    expect(() => service.markFalsePositive(report, finding.id, "benign")).toThrow();
  });

  it("allows marking a low-confidence email as false positive", () => {
    const service = new HandoffPrivacyService();
    const report = service.scan({ continuity: "contact dev@example.com for help" });
    const finding = report.findings[0]!;
    const updated = service.markFalsePositive(report, finding.id, "public address");
    expect(updated.findings[0]!.status).toBe("false-positive");
  });

  it("produces a schema-valid report", () => {
    const report = new HandoffPrivacyService().scan({ continuity: "nothing sensitive here" });
    expect(() => HandoffPrivacyReportSchema.parse(report)).not.toThrow();
  });
});
