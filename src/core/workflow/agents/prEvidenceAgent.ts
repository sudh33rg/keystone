import type {
  ContextPack,
  ModernizationAssessment,
  PerformanceAnalysis,
  PrEvidence,
  QaAnalysis,
  SecurityAnalysis
} from "../../domain/types";

export class PrEvidenceAgent {
  generate(
    pack: ContextPack,
    qa: QaAnalysis,
    security: SecurityAnalysis,
    performance: PerformanceAnalysis,
    modernization: ModernizationAssessment
  ): PrEvidence {
    const filesImpacted = pack.relevantFiles.map((file) => file.path);
    const testsImpacted = qa.impactedTests.map((test) => test.testFile);
    const risks = [
      ...pack.routeDecision.risks,
      `security=${security.riskLevel}`,
      `performance=${performance.riskLevel}`,
      `modernization=${modernization.riskLevel}`
    ];
    const markdown = [
      "## Summary",
      pack.taskSummary,
      "",
      "## Keystone Route",
      `Route: ${pack.routeDecision.selectedRoute}`,
      pack.routeDecision.reason,
      "",
      "## Context Used",
      ...filesImpacted.map((file) => `- ${file}`),
      "",
      "## Impact",
      `APIs impacted: ${pack.relatedApis.length}`,
      `Services impacted: ${pack.impactedServices.length}`,
      "",
      "## QA Evidence",
      ...qa.checklist.map((item) => `- ${item}`),
      ...qa.missingTestAreas.map((item) => `- Gap: ${item}`),
      "",
      "## Security Review",
      ...security.prNotes.map((item) => `- ${item}`),
      "",
      "## Performance Review",
      ...performance.prNotes.map((item) => `- ${item}`),
      "",
      "## Modernization Notes",
      ...modernization.phasedPlan.slice(0, 5).map((item) => `- ${item}`),
      "",
      "## Risks / Assumptions",
      ...risks.map((risk) => `- ${risk}`),
      "",
      "## Reviewer Guidance",
      "- Review the scoped files, QA gaps, and risk notes before merging.",
      "- Confirm Copilot prompt was user-approved before implementation."
    ].join("\n");
    return {
      markdown,
      changedSummary: pack.taskSummary,
      route: pack.routeDecision,
      filesImpacted,
      testsImpacted,
      risks,
      assumptions: ["Token savings are estimated from character count, not measured runtime usage."]
    };
  }
}
