import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TypeScriptSemanticCache } from "@core/intelligence/cpg/typescriptSemanticCache";
import type { TypeScriptSemanticResult } from "@core/intelligence/cpg/typescriptSemantic";

const RESULT: TypeScriptSemanticResult = {
  projectConfigs: ["tsconfig.json"],
  files: 1,
  calls: [],
  relationships: [],
  callbacks: [],
  unresolvedCalls: 0,
  diagnostics: 0,
  configuredDiagnostics: 0,
  fallbackDiagnostics: 0,
  configuredFiles: 1,
  fallbackFiles: 0,
  diagnosticCodes: {},
  diagnosticExamples: []
};

test("semantic cache reuses only an identical source and config fingerprint", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "keystone-semantic-cache-"));
  try {
    const cache = new TypeScriptSemanticCache(workspace);
    const input = {
      sourceFiles: [{ path: "src/app.ts", contentHash: "source-v1" }],
      configFiles: [{ path: "tsconfig.json", contentHash: "config-v1" }]
    };
    await cache.write(input, RESULT);

    assert.deepEqual(await cache.read(input), RESULT);
    assert.equal(
      await cache.read({ ...input, sourceFiles: [{ path: "src/app.ts", contentHash: "source-v2" }] }),
      undefined
    );
    assert.equal(
      await cache.read({ ...input, configFiles: [{ path: "tsconfig.json", contentHash: "config-v2" }] }),
      undefined
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
