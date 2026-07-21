import { describe, expect, it } from "vitest";
import { redact } from "../../src/shared/logging/redaction";

describe("redact", () => {
  it("redacts common credentials from log text", () => {
    const value = redact(
      "token=abc123 password:supersecret Authorization=BearerValue Bearer eyJ.fake.token",
    );
    expect(value).not.toContain("abc123");
    expect(value).not.toContain("supersecret");
    expect(value).not.toContain("eyJ.fake.token");
    expect(value).toContain("[REDACTED]");
  });

  it("redacts private-key blocks", () => {
    const value = redact("-----BEGIN PRIVATE KEY-----\nvery-sensitive\n-----END PRIVATE KEY-----");
    expect(value).toBe("[REDACTED PRIVATE KEY]");
  });

  it("does not fail on circular data", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(redact(value)).toBe("[object Object]");
  });
});
