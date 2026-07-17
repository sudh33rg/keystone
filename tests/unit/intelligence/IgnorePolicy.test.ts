import { describe, expect, it } from "vitest";
import { DefaultIgnorePolicy } from "../../../src/core/intelligence/IgnorePolicy";

describe("DefaultIgnorePolicy", () => {
  const policy = new DefaultIgnorePolicy();

  it("excludes the VS Code extension-test runtime cache", () => {
    expect(policy.decide(".vscode-test/user-data/languagepacks.json")).toMatchObject({ included: false, ruleId: "exclude.directory" });
  });

  it("indexes tests as source intelligence and never marks them generated", () => {
    expect(policy.decide("tests/generated/example.test.ts")).toMatchObject({ category: "test", analysisLevel: "deep", included: true, generated: false });
  });

  it("keeps Keystone intelligence output out of repository ingestion", () => {
    expect(policy.decide(".keystone/intelligence/tests/generated.test.ts")).toMatchObject({ included: false, analysisLevel: "excluded", ruleId: "exclude.keystone-intelligence" });
  });

  it("includes required engineering artifacts", () => {
    expect(policy.decide(".github/workflows/ci.yml").category).toBe("ci");
    expect(policy.decide("db/migrations/001.sql").category).toBe("migration");
    expect(policy.decide("openapi.yaml").category).toBe("schema");
    expect(policy.decide("Dockerfile").category).toBe("infrastructure");
    expect(policy.decide("README.md").category).toBe("documentation");
  });

  it("excludes dependencies and output while retaining sensitive files as metadata only", () => {
    expect(policy.decide("node_modules/pkg/index.js")).toMatchObject({ included: false, analysisLevel: "excluded" });
    expect(policy.decide("node_modules/pkg/tests/index.test.js")).toMatchObject({ included: false, ruleId: "exclude.directory" });
    expect(policy.decide(".vscode-test/extensions/example/tests/index.test.js")).toMatchObject({ included: false, ruleId: "exclude.directory" });
    expect(policy.decide("dist/tests/app.test.js")).toMatchObject({ included: false, ruleId: "exclude.directory" });
    expect(policy.decide("dist/app.js")).toMatchObject({ included: false, generated: true });
    expect(policy.decide(".env.production")).toMatchObject({ included: true, sensitive: true, analysisLevel: "metadata-only" });
  });

  it("detects binary content without decoding it", () => {
    expect(policy.decide("unknown.data", new Uint8Array([1, 0, 2]))).toMatchObject({ included: false, binary: true });
  });
});
