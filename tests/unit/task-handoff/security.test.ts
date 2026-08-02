import { describe, expect, it } from "../../support/testkit";
import {
  decryptHandoffPackage,
  encryptHandoffPackage,
  scanAndRedact
} from "../../../src/core/workflow/handoff/handoffSecurity";
describe("session security", () => {
  it("redacts credentials without returning their value", () => {
    const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const result = scanAndRedact({
      note: `Authorization: Bearer ${token}`,
      file: ".env.production"
    });
    expect(JSON.stringify(result.value)).not.toContain(token);
    expect(result.report.removedCategories).toContain("authorization-header");
    expect(result.value.file).toContain("REDACTED");
  });
  it("encrypts handoffs and rejects an incorrect passphrase", async () => {
    const plaintext = '{"task":"handoff"}';
    const encrypted = await encryptHandoffPackage(plaintext, "correct horse battery staple");
    expect(encrypted).not.toContain(plaintext);
    await expect(decryptHandoffPackage(encrypted, "wrong passphrase")).rejects.toThrow(
      /securely processed/
    );
    await expect(decryptHandoffPackage(encrypted, "correct horse battery staple")).resolves.toBe(
      plaintext
    );
  });
  it("requires a sufficiently long creation passphrase", async () => {
    await expect(encryptHandoffPackage("value", "short")).rejects.toThrow(/12 characters/);
  });
});
