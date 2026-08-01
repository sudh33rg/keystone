import { DEFAULT_QA_CHECKLIST } from '../../platform/config/defaults';
import type { ContextPack, QaAnalysis, RepoIntelligence, TestMapping } from '../../domain/types';
import { analyzeRepositoryGraph } from '../../intelligence/pipeline/derivedGraph';

/**
 * Evidence-backed QA analysis. Impacted tests are derived from the selected
 * context, explicit test mappings, and reverse repository-graph traversal.
 * No test-count ceiling is applied.
 */
export class QaAgent {
  analyze(pack: ContextPack, intelligence: RepoIntelligence): QaAnalysis {
    const selectedFiles = pack.relevantFiles.map(file => file.path);
    const graphImpact = analyzeRepositoryGraph(intelligence).impactedBy(selectedFiles);
    const impactedPaths = new Set([...selectedFiles, ...graphImpact.files]);
    const mapped = intelligence.tests.filter(test =>
      impactedPaths.has(test.testFile) || Boolean(test.targetFile && impactedPaths.has(test.targetFile)),
    );
    const impactedTests = mergeTests([...pack.relatedTests, ...mapped, ...graphImpact.tests.map(testFile => ({
      testFile,
      confidence: 0.7,
      reason: 'Reverse dependency traversal links this test to the selected change context.',
      evidence: { source: 'heuristic' as const, confidence: 0.7, evidencePath: testFile, extractorVersion: 'qa-impact-v2' },
    }))]);
    const missingTestAreas = impactedTests.length === 0
      ? ['No mapped or graph-impacted tests were found for the selected change context.']
      : [];
    return {
      impactedTests,
      missingTestAreas,
      recommendedTests: [
        'successful path validates the accepted behavior',
        'negative path preserves failure semantics',
        'authorization and sensitive-data paths are covered where applicable',
        'regression coverage links each changed behavior to an acceptance criterion',
      ],
      checklist: [...DEFAULT_QA_CHECKLIST, `Review all ${graphImpact.files.length} graph-impacted file(s).`, `Run all ${impactedTests.length} mapped or graph-impacted test file(s).`],
      coverageConfidence: impactedTests.length > 0 ? Math.min(0.95, 0.6 + impactedTests.reduce((sum, item) => sum + item.confidence, 0) / impactedTests.length * 0.35) : 0.35,
      regressionNeeds: impactedTests.length ? impactedTests.map(test => `Run ${test.testFile}`) : ['Create acceptance-criterion-linked regression tests before completion.'],
      copilotFeedbackPrompt: 'If validation fails, classify the failure, show evidence, and propose the smallest user-approved remediation without weakening tests.',
    };
  }
}

function mergeTests(values: TestMapping[]): TestMapping[] {
  const byFile = new Map<string, TestMapping>();
  for (const value of values) {
    const current = byFile.get(value.testFile);
    if (!current || value.confidence > current.confidence) byFile.set(value.testFile, value);
  }
  return [...byFile.values()].sort((a, b) => b.confidence - a.confidence || a.testFile.localeCompare(b.testFile));
}
