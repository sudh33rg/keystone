import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const workspaceRoot = process.argv[2];
const mode = process.argv[3] ?? "index";
const outputPath = process.argv[4];
if (!workspaceRoot)
  throw new Error(
    "Usage: node scripts/verify-production-cockpit.mjs <workspace-root> <index|query|analyze>"
  );
const { CockpitService } = require(
  path.join(process.cwd(), "dist/app/core/integration/webview/cockpitService.js")
);
const service = new CockpitService(workspaceRoot);
if (process.env.KEYSTONE_VERIFY_PROGRESS === "1") {
  const originalActivity = service.activity.bind(service);
  service.activity = async (...args) => {
    const activityStarted = Date.now();
    console.error(`[production-index] activity read start`);
    const value = await originalActivity(...args);
    console.error(`[production-index] activity read done ${Date.now() - activityStarted}ms`);
    return value;
  };
}
const started = Date.now();
let result;
if (mode === "index") {
  const state = await service.index((message, progress, stage) => {
    if (process.env.KEYSTONE_VERIFY_PROGRESS === "1")
      console.error(
        `[production-index] ${Date.now() - started}ms ${progress}% ${stage}: ${message}`
      );
  });
  result = {
    mode,
    status: state.status,
    fileCount: state.intelligence?.fileCount ?? 0,
    okfValid: state.intelligence?.okf?.validated === true,
    okfUnits: state.intelligence?.okf?.units ?? 0,
    okfRelationships: state.intelligence?.okf?.relationships ?? 0,
    cpgBindings: state.intelligence?.okf?.cpgBindings ?? 0,
    elapsedMs: Date.now() - started
  };
} else if (mode === "query") {
  const query = await service.queryIntelligence(
    "What tests are impacted by changing the OKF query engine?"
  );
  result = {
    mode,
    queryResults: query.items.length,
    queryEvidenceResults: query.items.filter((item) => item.evidenceIds?.length > 0).length,
    queryTraversals: query.traversedRelationships,
    answer: query.answer,
    elapsedMs: Date.now() - started
  };
} else if (mode === "analyze") {
  const task = await service.analyze(
    "Improve the OKF query engine while preserving impacted tests and read-only Git review.",
    { currentFile: "src/core/intelligence/okf/queryEngine.ts" }
  );
  result = {
    mode,
    intentRetrievalMode: task.retrievalMetrics?.mode ?? "unknown",
    readOnlyGitEvidence: task.analysisEvidence?.gitReview.readOnly === true,
    copilotCustomizations: {
      agents: task.copilotCustomizations?.agents.length ?? 0,
      skills: task.copilotCustomizations?.skills.length ?? 0,
      instructions: task.copilotCustomizations?.instructions.length ?? 0
    },
    qaGaps: task.analysisEvidence?.qa.gaps.length ?? 0,
    securityFindings: task.analysisEvidence?.security.findings.length ?? 0,
    performanceFindings: task.analysisEvidence?.performance.findings.length ?? 0,
    modernizationGaps: task.analysisEvidence?.modernization.gaps.length ?? 0,
    elapsedMs: Date.now() - started
  };
} else {
  throw new Error(`Unknown production cockpit verification mode: ${mode}`);
}
const serialized = JSON.stringify(result);
if (outputPath) await fs.writeFile(outputPath, `${serialized}\n`, "utf8");
else console.log(serialized);
process.exit(0);
