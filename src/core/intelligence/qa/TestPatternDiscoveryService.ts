/**
 * TestPatternDiscoveryService (spec §8) + TestLocationRecommendationService (spec §9).
 *
 * Identify representative existing tests that demonstrate repository conventions (framework syntax,
 * naming, folder placement, setup/teardown, fixtures, mocking, assertion style, async handling, etc.)
 * and rank them by relevance to the target (same module, production entity, test layer, framework,
 * side-effect type, repository area, recency, user confirmation). Bounded representative examples are
 * preferred over dumping entire unrelated suites.
 *
 * Location recommendation reuses the repository's existing test layout; it never invents a new test
 * organization pattern when one already exists.
 */
import { createHash } from "node:crypto";
import {
  TestPatternExampleSchema,
  TestPatternDiscoveryResultSchema,
  TestLocationRecommendationSchema,
  type TestPatternDiscoveryResult,
  type TestLocationRecommendation,
  type TestLayer,
} from "../../../shared/contracts/qaRemediation";

export interface CandidateTest {
  testId: string;
  filePath: string;
  frameworkId?: string;
  testLayer: TestLayer;
  /** Free-form signals used for ranking (e.g. "uses-fixtures", "async", "mock-vitest"). */
  signals?: string[];
  /** ISO timestamp of last modification, for recency ranking. */
  lastModified?: string;
  userConfirmed?: boolean;
}

export interface LocationContext {
  productionFilePath: string;
  productionEntityId: string;
  testLayer: TestLayer;
  frameworkId?: string;
  /** Existing test files in the repository, used to infer layout conventions. */
  existingTestFiles: string[];
  suggestedLocation?: string;
}

export class TestPatternDiscoveryService {
  discover(
    candidates: CandidateTest[],
    target: {
      productionEntityId?: string;
      testLayer?: TestLayer;
      frameworkId?: string;
      modulePath?: string;
    },
  ): TestPatternDiscoveryResult {
    const ranked = candidates
      .map((c) => ({ c, score: this.score(c, target) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ c, score }) =>
        TestPatternExampleSchema.parse({
          testId: c.testId,
          filePath: c.filePath,
          frameworkId: c.frameworkId,
          testLayer: c.testLayer,
          rank: Math.round(score * 100) / 100,
          reasons: this.reasons(c, target),
        }),
      );

    return TestPatternDiscoveryResultSchema.parse({
      productionEntityId: target.productionEntityId,
      examples: ranked,
      metadata: {
        createdAt: new Date().toISOString(),
        contentHash: createHash("sha256").update(JSON.stringify(ranked)).digest("hex").slice(0, 32),
      },
    });
  }

  private score(
    c: CandidateTest,
    target: {
      productionEntityId?: string;
      testLayer?: TestLayer;
      frameworkId?: string;
      modulePath?: string;
    },
  ): number {
    let s = 0.1;
    if (target.testLayer && c.testLayer === target.testLayer) s += 0.25;
    if (target.frameworkId && c.frameworkId === target.frameworkId) s += 0.2;
    if (target.productionEntityId && c.filePath.includes(target.productionEntityId)) s += 0.25;
    if (target.modulePath && this.sameModule(c.filePath, target.modulePath)) s += 0.15;
    if (c.userConfirmed) s += 0.2;
    if (c.lastModified) {
      const ageDays = (Date.now() - Date.parse(c.lastModified)) / 86_400_000;
      if (ageDays < 90) s += 0.05;
    }
    return Math.min(1, s);
  }

  private reasons(
    c: CandidateTest,
    target: {
      productionEntityId?: string;
      testLayer?: TestLayer;
      frameworkId?: string;
      modulePath?: string;
    },
  ): string[] {
    const out: string[] = [];
    if (target.testLayer && c.testLayer === target.testLayer)
      out.push(`Same test layer (${c.testLayer}).`);
    if (target.frameworkId && c.frameworkId === target.frameworkId)
      out.push(`Same framework (${c.frameworkId}).`);
    if (target.productionEntityId && c.filePath.includes(target.productionEntityId))
      out.push("Same production entity.");
    if (c.userConfirmed) out.push("User-confirmed representative.");
    if (!out.length) out.push("Bounded representative example.");
    return out;
  }

  private sameModule(a: string, b: string): boolean {
    const seg = (p: string) => p.split(/[\\/]/).slice(0, -1).join("/");
    return (
      seg(a) === seg(b) ||
      (seg(a).length > 0 &&
        seg(b).length > 0 &&
        seg(a).split("/").slice(0, -1).join("/") === seg(b))
    );
  }
}

export class TestLocationRecommendationService {
  recommend(ctx: LocationContext): TestLocationRecommendation {
    const layer = ctx.testLayer;
    const fw = ctx.frameworkId;
    const base =
      ctx.suggestedLocation ??
      this.inferFromExisting(ctx.productionFilePath, ctx.existingTestFiles, layer);
    const createOrModify: "create" | "modify" = ctx.existingTestFiles.some((f) => f === base)
      ? "modify"
      : "create";
    const alternatives = ctx.existingTestFiles.filter((f) => f !== base).slice(0, 5);
    const confidence = base ? 0.7 : 0.3;

    return TestLocationRecommendationSchema.parse({
      proposedFile: base || `${ctx.productionFilePath}.test.ts`,
      createOrModify,
      frameworkId: fw,
      testLayer: layer,
      reasoning: base
        ? `Follows the repository's existing test layout next to ${ctx.productionFilePath}.`
        : "No existing convention detected; proposed adjacent co-located test file.",
      alternativeLocations: alternatives,
      confidence,
    });
  }

  private inferFromExisting(
    productionFilePath: string,
    existing: string[],
    layer: TestLayer,
  ): string | undefined {
    const dir = productionFilePath.split(/[\\/]/).slice(0, -1).join("/");
    const base =
      productionFilePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "module";
    const sibling = existing.find((f) => f.startsWith(dir) && /test|spec/i.test(f));
    if (sibling) return sibling;
    const ext = layer === "e2e" ? ".e2e.spec.ts" : ".test.ts";
    return `${dir ? dir + "/" : ""}${base}${ext}`;
  }
}
