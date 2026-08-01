import type { ModernizationArea, ModernizationStrategy, TransformationAction } from './model';

export interface ModernizationPattern {
  readonly id: string;
  readonly title: string;
  readonly area: ModernizationArea;
  readonly strategy: ModernizationStrategy;
  readonly description: string;
  readonly validation: readonly string[];
}

export const MODERNIZATION_PATTERNS: readonly ModernizationPattern[] = Object.freeze([
  {
    id: 'tests-before-change',
    title: 'Characterization tests before transformation',
    area: 'testing',
    strategy: 'incremental-upgrade',
    description: 'Capture current behavior before any migration step that can alter runtime behavior.',
    validation: ['Golden behavior captured', 'Regression suite runs in baseline CI'],
  },
  {
    id: 'strangler-boundary',
    title: 'Strangler boundary',
    area: 'architecture',
    strategy: 'strangler-fig',
    description: 'Introduce a stable boundary and migrate capabilities behind it incrementally.',
    validation: ['Old and new paths can run side by side', 'Rollback can route traffic to the existing path'],
  },
  {
    id: 'dependency-safe-upgrade',
    title: 'Dependency safe upgrade',
    area: 'dependency',
    strategy: 'incremental-upgrade',
    description: 'Upgrade dependencies in small batches with lockfile, compile, and test validation.',
    validation: ['Dependency graph has no downgraded packages', 'Build and tests pass after each batch'],
  },
  {
    id: 'api-compatibility-wrapper',
    title: 'API compatibility wrapper',
    area: 'api',
    strategy: 'refactor',
    description: 'Keep public contracts stable while internals move to the target architecture.',
    validation: ['Consumer contracts remain compatible', 'Deprecated routes have migration notes'],
  },
  {
    id: 'documentation-sync',
    title: 'Documentation synchronized with migration',
    area: 'documentation',
    strategy: 'retain',
    description: 'Update ADRs, runbooks, and architecture documents at each migration milestone.',
    validation: ['Decision record exists', 'Runbook reflects current rollback steps'],
  },
]);

export function patternsForArea(area: ModernizationArea): readonly ModernizationPattern[] {
  return MODERNIZATION_PATTERNS.filter(pattern => pattern.area === area);
}

export function actionFromPattern(pattern: ModernizationPattern, affectedAssets: readonly string[]): TransformationAction {
  return Object.freeze({
    id: `action-${pattern.id}`,
    area: pattern.area,
    description: pattern.description,
    reversible: pattern.strategy !== 'replace' && pattern.strategy !== 'retire',
    affectedAssets: Object.freeze([...affectedAssets]),
  });
}
