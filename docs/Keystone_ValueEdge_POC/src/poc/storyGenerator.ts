export interface ValueEdgeFeatureInput {
  id: string;
  name: string;
  description?: string;
}

export interface RepositoryEvidence {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  relativePath: string;
  language?: string;
  confidence?: number;
  matchedTerm?: string;
}

export interface GeneratedStory {
  kind: "story" | "quality_story";
  name: string;
  description: string;
  evidence: RepositoryEvidence[];
  rationale: string;
}

type Concern = "api" | "service" | "persistence" | "ui" | "test" | "validation" | "domain";

export function generateRepoAwareStories(
  feature: ValueEdgeFeatureInput,
  evidence: RepositoryEvidence[],
  generation: number,
): GeneratedStory[] {
  const ranked = dedupeEvidence(evidence).sort((a, b) => evidenceScore(b) - evidenceScore(a));
  const byConcern = new Map<Concern, RepositoryEvidence[]>();
  for (const concern of ["api", "service", "persistence", "ui", "test", "validation", "domain"] as Concern[]) {
    byConcern.set(concern, ranked.filter((item) => classify(item).has(concern)).slice(0, 8));
  }

  const implementationEvidence = selectDistinct([
    ...(byConcern.get("domain") ?? []),
    ...(byConcern.get("service") ?? []),
    ...(byConcern.get("api") ?? []),
    ...(byConcern.get("persistence") ?? []),
    ...(byConcern.get("ui") ?? []),
  ], 8);
  const fallback = implementationEvidence.length ? implementationEvidence : ranked.slice(0, 8);
  const userStories: GeneratedStory[] = [];

  userStories.push({
    kind: "story",
    name: `Implement ${feature.name} in the existing repository flow`,
    rationale: `Anchors the feature to ${Math.max(1, fallback.length)} concrete repository touchpoint(s) instead of deriving scope from the feature text alone.`,
    description: storyDescription(feature, generation, [
      `As a product user, I want ${sentenceCase(feature.name)} so that the requested ValueEdge feature is delivered through the application's established implementation path.`,
      ...acceptanceForCore(fallback),
    ]),
    evidence: fallback.slice(0, 8),
  });

  const apiEvidence = selectDistinct([...(byConcern.get("api") ?? []), ...(byConcern.get("service") ?? [])], 8);
  if (apiEvidence.length) {
    userStories.push({
      kind: "story",
      name: `Integrate ${feature.name} with the existing API/service contract`,
      rationale: "Repository intelligence found request/service boundaries that should constrain the implementation and prevent a parallel integration path.",
      description: storyDescription(feature, generation, [
        `As an API consumer, I want ${sentenceCase(feature.name)} to use the existing request and service boundaries so that current integrations remain consistent.`,
        ...acceptanceForApi(apiEvidence),
      ]),
      evidence: apiEvidence,
    });
  }

  const persistenceEvidence = byConcern.get("persistence") ?? [];
  if (persistenceEvidence.length) {
    userStories.push({
      kind: "story",
      name: `Persist ${feature.name} using the existing data model`,
      rationale: "Repository intelligence found persistence/model touchpoints that make data behavior part of the feature scope.",
      description: storyDescription(feature, generation, [
        `As a product user, I want ${sentenceCase(feature.name)} to preserve its data through the existing persistence model so that behavior remains consistent with the rest of the product.`,
        ...acceptanceForPersistence(persistenceEvidence),
      ]),
      evidence: persistenceEvidence.slice(0, 8),
    });
  }

  const uiEvidence = byConcern.get("ui") ?? [];
  if (uiEvidence.length) {
    userStories.push({
      kind: "story",
      name: `Expose ${feature.name} through the existing user flow`,
      rationale: "Repository intelligence found UI/view touchpoints, so the story names the existing surface that should be extended.",
      description: storyDescription(feature, generation, [
        `As a product user, I want to access ${sentenceCase(feature.name)} through the existing user flow so that the capability feels native to the product.`,
        ...acceptanceForUi(uiEvidence, apiEvidence),
      ]),
      evidence: selectDistinct([...uiEvidence, ...apiEvidence], 8),
    });
  }

  const testEvidence = byConcern.get("test") ?? [];
  const qualityStories: GeneratedStory[] = [{
    kind: "quality_story",
    name: `Verify ${feature.name} across impacted repository paths`,
    rationale: "Turns the implementation evidence into a regression scope, including concrete existing tests when repository intelligence can identify them.",
    description: qualityDescription(feature, generation, [
      ...acceptanceForQuality(fallback, testEvidence),
    ]),
    evidence: selectDistinct([...testEvidence, ...fallback], 10),
  }];

  if (testEvidence.length) {
    qualityStories.push({
      kind: "quality_story",
      name: `Extend existing automated coverage for ${feature.name}`,
      rationale: "Existing test assets were found, allowing the POC to direct new coverage into established suites instead of proposing disconnected tests.",
      description: qualityDescription(feature, generation, acceptanceForAutomation(testEvidence, fallback)),
      evidence: selectDistinct([...testEvidence, ...fallback], 10),
    });
  }

  if (apiEvidence.length) {
    qualityStories.push({
      kind: "quality_story",
      name: `Protect API/service compatibility for ${feature.name}`,
      rationale: "API/service evidence creates a concrete contract-regression risk that deserves explicit quality coverage.",
      description: qualityDescription(feature, generation, acceptanceForApiQuality(apiEvidence)),
      evidence: apiEvidence,
    });
  }

  return [...userStories.slice(0, 4), ...qualityStories.slice(0, 3)];
}

function acceptanceForCore(items: RepositoryEvidence[]): string[] {
  const points = refs(items, 4);
  return [
    points.length
      ? `Implementation uses the identified touchpoints (${points.join("; ")}) as the primary change path; any intentional deviation is documented during refinement.`
      : "Implementation scope is explicitly refined before development because no strong repository touchpoint was found.",
    "Existing public behavior outside the feature remains unchanged unless the ValueEdge feature explicitly requires a contract change.",
    "The completed change has traceable automated or manual verification for the repository paths modified by the story.",
  ];
}

function acceptanceForApi(items: RepositoryEvidence[]): string[] {
  return [
    `The feature is implemented through the existing API/service touchpoints: ${refs(items, 5).join("; ")}.`,
    "Existing request validation, error handling, and response conventions on those touchpoints are preserved unless the feature explicitly changes them.",
    "Success, invalid-input, and service-failure behavior is verified at the closest existing contract boundary.",
  ];
}

function acceptanceForPersistence(items: RepositoryEvidence[]): string[] {
  return [
    `Data changes use the existing persistence/model touchpoints: ${refs(items, 5).join("; ")}.`,
    "Existing records remain readable and existing callers remain compatible unless a migration/contract change is explicitly required.",
    "Create/update/read behavior and failure handling are verified for the affected persistence path.",
  ];
}

function acceptanceForUi(ui: RepositoryEvidence[], api: RepositoryEvidence[]): string[] {
  const criteria = [
    `The capability is exposed by extending the existing UI touchpoints: ${refs(ui, 5).join("; ")}.`,
    "Loading, validation, success, empty, and failure states follow the conventions already present on the impacted UI path.",
  ];
  if (api.length) criteria.push(`The UI uses the identified existing API/service path (${refs(api, 3).join("; ")}) rather than introducing a duplicate integration route.`);
  return criteria;
}

function acceptanceForQuality(implementation: RepositoryEvidence[], tests: RepositoryEvidence[]): string[] {
  const result = [
    `Regression coverage includes the implementation touchpoints: ${refs(implementation, 5).join("; ") || "scope to be refined"}.`,
    "Verify the happy path, invalid/boundary input, dependency/service failure, and unchanged pre-existing behavior around the impacted flow.",
  ];
  if (tests.length) result.push(`Use or extend the closest existing test assets: ${refs(tests, 6).join("; ")}.`);
  else result.push("Add coverage at the repository's nearest existing test layer and record the chosen suite during refinement.");
  return result;
}

function acceptanceForAutomation(tests: RepositoryEvidence[], implementation: RepositoryEvidence[]): string[] {
  return [
    `Extend these existing test assets where applicable: ${refs(tests, 7).join("; ")}.`,
    `Exercise the impacted implementation touchpoints: ${refs(implementation, 5).join("; ")}.`,
    "Coverage includes positive, negative, boundary, and regression cases and reuses existing fixtures/mocks/helpers when present.",
    "All affected existing tests continue to pass after the feature tests are added.",
  ];
}

function acceptanceForApiQuality(items: RepositoryEvidence[]): string[] {
  return [
    `Contract verification covers these existing boundaries: ${refs(items, 6).join("; ")}.`,
    "Verify response shape/status behavior for success, validation failure, not-found/empty behavior where applicable, and downstream failure.",
    "Existing consumers that are outside the new feature continue to receive backward-compatible behavior.",
  ];
}

function storyDescription(feature: ValueEdgeFeatureInput, generation: number, lines: string[]): string {
  const [statement, ...acceptance] = lines;
  return `<p><strong>POC source:</strong> ValueEdge feature + Keystone repository intelligence generation ${generation}.</p><p><strong>User story</strong></p><p>${escapeHtml(statement ?? feature.name)}</p><p><strong>Feature context</strong></p><p>${escapeHtml(clean(feature.description || feature.name))}</p><p><strong>Acceptance criteria</strong></p><ul>${acceptance.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`;
}

function qualityDescription(feature: ValueEdgeFeatureInput, generation: number, acceptance: string[]): string {
  return `<p><strong>POC source:</strong> ValueEdge feature + Keystone repository intelligence generation ${generation}.</p><p><strong>Quality objective</strong></p><p>Validate ${escapeHtml(feature.name)} against the concrete implementation and regression paths identified in the current repository.</p><p><strong>Acceptance criteria</strong></p><ul>${acceptance.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`;
}

function classify(item: RepositoryEvidence): Set<Concern> {
  const value = `${item.type} ${item.name} ${item.relativePath}`.toLowerCase();
  const path = item.relativePath.toLowerCase();
  const out = new Set<Concern>();
  const isTest = /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.|fixture|mock|e2e|integration/.test(value);
  if (isTest) out.add("test");
  const serverLike = /(^|\/)(server|backend|api)(\/|$)/.test(path);
  if (!isTest && (/controller|endpoint|handler|resolver|api\b|rest|graphql/.test(value) || (serverLike && /route/.test(value)) || /\/api\//.test(path))) out.add("api");
  if (!isTest && /service|usecase|use_case|application|manager|facade|orchestr/.test(value)) out.add("service");
  if (!isTest && /repository|dao|entity|model|schema|database|sql|migration|persistence|store/.test(value)) out.add("persistence");
  if (!isTest && (/component|view|page|screen|form|dialog|panel|react|angular|vue|\.tsx\b|\.jsx\b/.test(value) || (/route/.test(value) && /(^|\/)(ui|web|frontend)(\/|$)/.test(path)))) out.add("ui");
  if (!isTest && /validat|guard|policy|permission|authoriz|schema/.test(value)) out.add("validation");
  if (!isTest && (/class|interface|function|method|module|package|enum|domain|aggregate/.test(value) || out.size === 0)) out.add("domain");
  return out;
}

function evidenceScore(item: RepositoryEvidence): number {
  const concernWeight = classify(item).size * 10;
  const confidence = Math.round((item.confidence ?? 0.5) * 10);
  const testBonus = classify(item).has("test") ? 4 : 0;
  return concernWeight + confidence + testBonus;
}

function refs(items: RepositoryEvidence[], limit: number): string[] {
  return selectDistinct(items, limit).map((item) => `${item.qualifiedName} [${item.relativePath}]`);
}

function dedupeEvidence(items: RepositoryEvidence[]): RepositoryEvidence[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.id || `${item.qualifiedName}|${item.relativePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectDistinct(items: RepositoryEvidence[], limit: number): RepositoryEvidence[] {
  const result: RepositoryEvidence[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.id || `${item.qualifiedName}|${item.relativePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function clean(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function sentenceCase(value: string): string {
  const cleanValue = clean(value).replace(/[.]+$/, "");
  return cleanValue ? cleanValue.charAt(0).toLowerCase() + cleanValue.slice(1) : "the feature";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
