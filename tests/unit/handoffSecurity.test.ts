import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoHighConfidenceSecrets,
  encryptHandoffPackage,
  scanAndRedact
} from "@core/workflow/handoff/handoffSecurity";

test("redaction report does not mark high-confidence secrets safe to share", () => {
  const result = scanAndRedact({ authorization: "Authorization: Bearer secret-token-value" });

  assert.equal(result.report.safeToShare, false);
  assert.equal(result.report.findings[0]?.confidence, "HIGH");
  assert.match(result.value.authorization, /REDACTED:AUTHORIZATION-HEADER/);
});

test("handoff security rejects unsafe payloads and weak passphrases", async () => {
  assert.throws(() => assertNoHighConfidenceSecrets("Authorization: Bearer token-value"));
  await assert.rejects(() => encryptHandoffPackage("payload", "short"));
});
