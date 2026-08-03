import path from "node:path";
import type {
  EngineeringEntityFact,
  SemanticRelationshipFact,
  TechnologyFingerprint
} from "../../domain/types";
import { analyzeLanguageFile, type LanguageAnalysisResult } from "../languages/languageAnalysis";
import { LanguageCapabilityRegistry } from "../languages/languageRegistry";

/**
 * Extension point for deterministic language frontends.  The core indexer only
 * invokes this contract; language, framework, and persistence knowledge remain
 * registered plugins instead of becoming branches in the ingestion pipeline.
 */
export interface LanguageAnalyzerAdapter {
  readonly id: string;
  readonly languages: readonly string[];
  readonly capabilities: readonly string[];
  detect(filePath: string, source: string): number;
  analyze?(filePath: string, source: string): LanguageAnalysisResult;
}
export interface EnrichmentContext {
  filePath: string;
  language: string;
  source: string;
  analysis: LanguageAnalysisResult;
}
export interface EcosystemDetection {
  id: string;
  category: EcosystemDetector["category"];
  confidence: number;
  evidence: string[];
  capabilities: string[];
  facts: EngineeringEntityFact[];
  relationships: SemanticRelationshipFact[];
}
export interface EcosystemDetector {
  readonly id: string;
  readonly languages: readonly string[];
  readonly category: "framework" | "persistence" | "messaging" | "contract";
  detect(context: EnrichmentContext): EcosystemDetection | undefined;
}

export class LanguageAdapterRegistry {
  private readonly adapters = new Map<string, LanguageAnalyzerAdapter>();
  register(adapter: LanguageAnalyzerAdapter): this { this.adapters.set(adapter.id, adapter); return this; }
  forFile(filePath: string, source: string): LanguageAnalyzerAdapter | undefined {
    return [...this.adapters.values()].filter((item) => item.detect(filePath, source) > 0)
      .sort((a, b) => b.detect(filePath, source) - a.detect(filePath, source))[0];
  }
  all(): readonly LanguageAnalyzerAdapter[] { return [...this.adapters.values()]; }
  analyze(filePath: string, source: string): LanguageAnalysisResult {
    const adapter = this.forFile(filePath, source);
    return adapter?.analyze?.(filePath, source) ?? analyzeLanguageFile(filePath, source);
  }
}
export class EcosystemRegistry {
  private readonly detectors = new Map<string, EcosystemDetector>();
  register(detector: EcosystemDetector): this { this.detectors.set(detector.id, detector); return this; }
  enrich(context: EnrichmentContext): EcosystemDetection[] {
    return [...this.detectors.values()]
      .filter(
        (detector) =>
          detector.languages.includes(context.language) ||
          detector.languages.includes("*") ||
          isEcosystemManifest(context.filePath)
      )
      .map((detector) => {
        const result = detector.detect(context);
        return result ? { ...result, category: detector.category } : undefined;
      }).filter((value): value is EcosystemDetection => Boolean(value));
  }
  all(): readonly EcosystemDetector[] { return [...this.detectors.values()]; }
}

function isEcosystemManifest(filePath: string): boolean {
  return /(?:^|\/)(?:package\.json|pom\.xml|build\.gradle(?:\.kts)?|[^/]+\.(?:csproj|vbproj)|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml)$/i.test(filePath);
}

const fact = (kind: EngineeringEntityFact["kind"], name: string, context: EnrichmentContext, properties: Record<string, unknown> = {}, confidence = 0.86): EngineeringEntityFact => ({
  kind, name, filePath: context.filePath, line: 1, properties,
  evidence: { source: "heuristic", confidence, evidencePath: context.filePath, evidenceLine: 1, extractorVersion: "ecosystem-registry:v1" }
});
const detector = (id: string, languages: string[], category: EcosystemDetector["category"], signals: RegExp[], capabilities: string[], build?: (c: EnrichmentContext) => EngineeringEntityFact[]): EcosystemDetector => ({
  id, languages, category,
  detect(context) {
    const evidence = signals.filter((signal) => signal.test(context.source) || signal.test(context.filePath)).map((signal) => signal.source);
    if (!evidence.length) return undefined;
    const confidence = Math.min(0.97, 0.58 + evidence.length * 0.14);
    const facts = build?.(context) ?? defaultFacts(id, category, context, confidence);
    return {
      id,
      category,
      confidence,
      evidence,
      capabilities,
      facts,
      relationships: defaultRelationships(id, category, context, facts, confidence)
    };
  }
});

export const ecosystemRegistry = new EcosystemRegistry()
  .register(detector("nestjs", ["typescript", "javascript"], "framework", [/@nestjs\//i, /@(Module|Controller|Injectable|Get|Post|UseGuards)\b/], ["routes", "controllers", "dependency-injection", "guards"]))
  .register(detector("express", ["typescript", "javascript"], "framework", [/\bexpress\b/i, /\b(?:app|router)\.(?:get|post|put|patch|delete)\b/], ["routes", "middleware"]))
  .register(detector("spring", ["java"], "framework", [/org\.springframework/i, /@(RestController|Controller|Service|Repository|(?:Get|Post|Put|Delete)Mapping)\b/], ["routes", "controllers", "dependency-injection", "repositories"]))
  .register(detector("aspnet", ["csharp", "vbnet"], "framework", [/Microsoft\.AspNetCore/i, /\[(?:Route|HttpGet|HttpPost|HttpPut|HttpDelete)\b/, /\bMap(?:Get|Post|Put|Delete|Group)\b/], ["routes", "controllers", "middleware", "dependency-injection"]))
  .register(detector("fastapi", ["python"], "framework", [/\bFastAPI\b/, /(?:@app|@router)\.(?:get|post|put|patch|delete)\b/, /\bDepends\s*\(/], ["routes", "handlers", "dependency-injection"]))
  .register(detector("django", ["python"], "framework", [/\bdjango\b/i, /\bpath\s*\(/, /\bmodels\.Model\b/], ["routes", "models", "middleware"]))
  .register(detector("gin", ["go"], "framework", [/github\.com\/gin-gonic\/gin/, /\.(?:GET|POST|PUT|DELETE)\s*\(/], ["routes", "handlers"]))
  .register(detector("axum", ["rust"], "framework", [/\baxum\b/i, /\broute\s*\(/], ["routes", "handlers"]))
  .register(detector("typeorm", ["typescript", "javascript"], "persistence", [/\btypeorm\b/i, /@(Entity|Column|OneToMany|ManyToOne)\b/], ["entities", "relations", "repositories"]))
  .register(detector("prisma", ["typescript", "javascript"], "persistence", [/\b@prisma\/client\b/i, /\bmodel\s+\w+\s*\{/], ["models", "queries"]))
  .register(detector("hibernate", ["java"], "persistence", [/jakarta\.persistence|javax\.persistence|\bhibernate\b/i, /@(Entity|Table|Column|OneToMany|ManyToOne)\b/], ["entities", "relations", "repositories"]))
  .register(detector("entity-framework", ["csharp", "vbnet"], "persistence", [/\bEntityFramework\b|\bDbContext\b/i], ["entities", "queries", "migrations"]))
  .register(detector("sqlalchemy", ["python"], "persistence", [/\bsqlalchemy\b/i, /\bdeclarative_base\b|\bmapped_column\b/i], ["models", "queries"]))
  .register(detector("gorm", ["go"], "persistence", [/\bgorm\.io\b|\bgorm\.Model\b/i], ["models", "queries"]))
  .register(detector("sqlx", ["rust"], "persistence", [/\bsqlx\b/i], ["queries", "connections"]))
  .register(detector("kafka", ["*"], "messaging", [/\bkafka\b/i, /\bKafka(?:Template|Consumer|Producer)\b/], ["producers", "consumers", "topics"]))
  .register(detector("rabbitmq", ["*"], "messaging", [/\brabbitmq\b|\bamq[ps]?\b/i], ["producers", "consumers", "queues"]))
  .register(detector("graphql", ["*"], "contract", [/\bgraphql\b/i, /\btype\s+\w+\s*\{/], ["schemas", "resolvers"]))
  .register(detector("grpc", ["*"], "contract", [/\bgrpc\b|\.proto\b/i, /\brpc\s+\w+\s*\(/], ["rpc", "contracts"]));

const languageDefinitions = new LanguageCapabilityRegistry().all();
export const languageAdapterRegistry = new LanguageAdapterRegistry();
for (const definition of languageDefinitions)
  languageAdapterRegistry.register({
    id: `structural:${definition.id}`,
    languages: [definition.id],
    capabilities: ["syntax", "symbols", "imports", "calls", "controlFlow", "dataFlow"],
    detect(filePath) {
      return new LanguageCapabilityRegistry().identify(filePath)?.id === definition.id ? 1 : 0;
    },
    analyze: analyzeLanguageFile
  });

export function analyzeArtifact(filePath: string, source: string): LanguageAnalysisResult {
  return languageAdapterRegistry.analyze(filePath, source);
}

/** Build/package extraction is artifact-oriented and deliberately independent of source language adapters. */
export function extractBuildAndPackageFacts(
  filePath: string,
  source: string
): EngineeringEntityFact[] {
  const name = path.posix.basename(filePath).toLowerCase();
  const make = (kind: EngineeringEntityFact["kind"], value: string, properties: Record<string, unknown> = {}): EngineeringEntityFact => ({
    kind,
    name: value,
    filePath,
    line: 1,
    properties,
    evidence: { source: "filesystem", confidence: 0.93, evidencePath: filePath, evidenceLine: 1, extractorVersion: "build-package-registry:v1" }
  });
  if (name === "package.json") {
    try {
      const manifest = JSON.parse(source) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
      return [
        make("project", manifest.name ?? path.posix.dirname(filePath) ?? "workspace", { ecosystem: "npm" }),
        ...Object.entries(dependencies).map(([dependency, version]) => make("external-package", dependency, { ecosystem: "npm", version }))
      ];
    } catch { return []; }
  }
  if (name === "go.mod") return moduleFacts(source, /^module\s+([^\s]+)/m, /^require\s+([^\s]+)\s+([^\s]+)/gm, "go-modules", make);
  if (name === "cargo.toml") return tomlPackageFacts(source, "cargo", make);
  if (name === "pyproject.toml") return tomlPackageFacts(source, "python", make);
  if (name === "pom.xml") return xmlPackageFacts(source, "maven", make);
  if (/\.(?:csproj|vbproj)$/i.test(name)) return xmlPackageFacts(source, "nuget", make);
  return [];
}

/** Resolve only stable identifiers shared by independently analyzed projects. */
export function resolveCrossLanguageRelationships(
  facts: readonly EngineeringEntityFact[],
  fileLanguages: ReadonlyMap<string, string>
): SemanticRelationshipFact[] {
  const out: SemanticRelationshipFact[] = [];
  const evidence = (path: string, confidence: number) => ({
    source: "heuristic" as const,
    confidence,
    evidencePath: path,
    evidenceLine: 1,
    extractorVersion: "cross-language-resolver:v1"
  });
  const byTopic = (kind: EngineeringEntityFact["kind"]) =>
    facts.filter((fact) => fact.kind === kind).reduce((groups, fact) => {
      const topic = typeof fact.properties.topic === "string" ? fact.properties.topic : undefined;
      if (topic) groups.set(topic, [...(groups.get(topic) ?? []), fact]);
      return groups;
    }, new Map<string, EngineeringEntityFact[]>());
  const producers = byTopic("producer");
  const consumers = byTopic("consumer");
  for (const [topic, producerItems] of producers)
    for (const producer of producerItems)
      for (const consumer of consumers.get(topic) ?? [])
        if (fileLanguages.get(producer.filePath) !== fileLanguages.get(consumer.filePath))
          out.push({
            sourceKind: "producer", sourceName: producer.name, sourcePath: producer.filePath,
            targetKind: "consumer", targetName: consumer.name, targetPath: consumer.filePath,
            kind: "flows-to", confidence: 0.91, resolution: "exact", evidence: evidence(producer.filePath, 0.91)
          });
  const entities = facts.filter((fact) => ["entity", "model", "orm-entity"].includes(fact.kind));
  const tables = facts.filter((fact) => fact.kind === "table");
  for (const entity of entities)
    for (const table of tables)
      if (normalizeIdentifier(entity.name) === normalizeIdentifier(table.name) && entity.filePath !== table.filePath)
        out.push({
          sourceKind: entity.kind, sourceName: entity.name, sourcePath: entity.filePath,
          targetKind: "table", targetName: table.name, targetPath: table.filePath,
          kind: "maps-to", confidence: 0.78, resolution: "probable", evidence: evidence(entity.filePath, 0.78)
        });
  return out;
}

function moduleFacts(source: string, module: RegExp, dependency: RegExp, ecosystem: string, make: (kind: EngineeringEntityFact["kind"], value: string, properties?: Record<string, unknown>) => EngineeringEntityFact): EngineeringEntityFact[] {
  const facts: EngineeringEntityFact[] = [];
  const project = source.match(module)?.[1];
  if (project) facts.push(make("project", project, { ecosystem }));
  for (const match of source.matchAll(dependency)) facts.push(make("external-package", match[1], { ecosystem, version: match[2] }));
  return facts;
}
function tomlPackageFacts(source: string, ecosystem: string, make: (kind: EngineeringEntityFact["kind"], value: string, properties?: Record<string, unknown>) => EngineeringEntityFact): EngineeringEntityFact[] {
  const facts: EngineeringEntityFact[] = [];
  const name = source.match(/^name\s*=\s*["']([^"']+)/m)?.[1];
  if (name) facts.push(make("project", name, { ecosystem }));
  const section = /\[dependencies\]([\s\S]*?)(?=^\[|$)/m.exec(source)?.[1] ?? "";
  for (const match of section.matchAll(/^([\w.-]+)\s*=\s*["']?([^\s"']+)/gm)) facts.push(make("external-package", match[1], { ecosystem, version: match[2] }));
  return facts;
}
function xmlPackageFacts(source: string, ecosystem: string, make: (kind: EngineeringEntityFact["kind"], value: string, properties?: Record<string, unknown>) => EngineeringEntityFact): EngineeringEntityFact[] {
  const facts: EngineeringEntityFact[] = [];
  for (const match of source.matchAll(/<(?:PackageReference|dependency)[^>]*(?:Include|id)=["']([^"']+)["'][^>]*(?:Version|version)=["']?([^"'\s<]+)/gi)) facts.push(make("external-package", match[1], { ecosystem, version: match[2] }));
  for (const match of source.matchAll(/<artifactId>([^<]+)<\/artifactId>/gi)) facts.push(make("external-package", match[1], { ecosystem }));
  return facts;
}
function normalizeIdentifier(value: string): string {
  return value.replace(/(?:entity|model|table)$/i, "").replace(/[_\-\s]/g, "").toLowerCase();
}

export function enrichEcosystem(context: EnrichmentContext): EcosystemDetection[] { return ecosystemRegistry.enrich(context); }

function defaultFacts(
  id: string,
  category: EcosystemDetector["category"],
  context: EnrichmentContext,
  confidence: number
): EngineeringEntityFact[] {
  if (category === "framework") {
    const routes = context.analysis.apis.map((api) =>
      fact("route", `${api.method} ${api.path}`, context, { framework: id, method: api.method, path: api.path }, confidence)
    );
    const controllers = namedMatches(context.source, /@(Controller|RestController)\s*(?:\([^)]*\))?\s*(?:export\s+)?class\s+(\w+)/g, 2)
      .map((name) => fact("controller", name, context, { framework: id }, confidence));
    const services = namedMatches(context.source, /(?:@(?:Injectable|Service|Component)\s*(?:\([^)]*\))?\s*)?(?:export\s+)?class\s+(\w*(?:Service|Handler))/g, 1)
      .map((name) => fact("handler", name, context, { framework: id, role: "service" }, confidence));
    const repositories = namedMatches(context.source, /(?:@Repository\s*(?:\([^)]*\))?\s*)?(?:export\s+)?class\s+(\w*(?:Repository|Dao|DAO))/g, 1)
      .map((name) => fact("repository", name, context, { framework: id }, confidence));
    return [...routes, ...controllers, ...services, ...repositories];
  }
  if (category === "persistence") {
    const names = namedMatches(context.source, /(?:@Entity\s*(?:\([^)]*\))?\s*(?:export\s+)?class|class|struct)\s+(\w+)/g, 1);
    return names.slice(0, 100).map((name) => fact("entity", name, context, { persistence: id }, confidence));
  }
  if (category === "contract") {
    const name = path.posix.basename(context.filePath);
    return [fact("contract", name, context, { contract: id }, confidence)];
  }
  return messageFacts(id, context, confidence);
}

function defaultRelationships(
  id: string,
  category: EcosystemDetector["category"],
  context: EnrichmentContext,
  facts: readonly EngineeringEntityFact[],
  confidence: number
): SemanticRelationshipFact[] {
  const evidence = {
    source: "heuristic" as const,
    confidence,
    evidencePath: context.filePath,
    evidenceLine: 1,
    extractorVersion: "ecosystem-registry:v2"
  };
  if (category === "framework") {
    const controllers = facts.filter((item) => item.kind === "controller");
    const routes = facts.filter((item) => item.kind === "route");
    const handlers = facts.filter((item) => item.kind === "handler");
    const repositories = facts.filter((item) => item.kind === "repository");
    const routeEdges = routes.flatMap((route) => controllers.map((controller) => ({
      sourceKind: "controller" as const, sourceName: controller.name, sourcePath: context.filePath,
      targetKind: "route" as const, targetName: route.name, targetPath: context.filePath,
      kind: "exposes" as const, confidence, resolution: "probable" as const, evidence
    })));
    const handlerEdges = controllers.flatMap((controller) => handlers
      .filter((handler) => visibleReference(context.source, handler.name))
      .map((handler) => ({
      sourceKind: "controller" as const, sourceName: controller.name, sourcePath: context.filePath,
      targetKind: "handler" as const, targetName: handler.name, targetPath: context.filePath,
      kind: "uses" as const, confidence: Math.min(confidence, 0.82), resolution: "probable" as const, evidence
    })));
    const repositoryEdges = handlers.flatMap((handler) => repositories
      .filter((repository) => visibleReference(context.source, repository.name))
      .map((repository) => ({
      sourceKind: "handler" as const, sourceName: handler.name, sourcePath: context.filePath,
      targetKind: "repository" as const, targetName: repository.name, targetPath: context.filePath,
      kind: "uses" as const, confidence: Math.min(confidence, 0.8), resolution: "probable" as const, evidence
    })));
    return [...routeEdges, ...handlerEdges, ...repositoryEdges];
  }
  if (category === "messaging") {
    const producers = facts.filter((item) => item.kind === "producer");
    const messages = facts.filter((item) => item.kind === "message");
    return producers.flatMap((producer) => messages.map((message) => ({
      sourceKind: "producer" as const, sourceName: producer.name, sourcePath: context.filePath,
      targetKind: "message" as const, targetName: message.name, targetPath: context.filePath,
      kind: "publishes" as const, confidence, resolution: "probable" as const, evidence
    })));
  }
  return [];
}

function namedMatches(source: string, expression: RegExp, group: number): string[] {
  return [...source.matchAll(expression)].map((match) => match[group]).filter((name): name is string => Boolean(name));
}
function visibleReference(source: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (source.match(new RegExp(`\\b${escaped}\\b`, "g")) ?? []).length > 1;
}

function messageFacts(id: string, context: EnrichmentContext, confidence: number): EngineeringEntityFact[] {
  const topics = namedMatches(context.source, /(?:publish|send|produce|subscribe|consume)\s*\(\s*["'`]([^"'`]+)/gi, 1);
  return topics.flatMap((topic) => [
    fact("message", topic, context, { messaging: id, topic }, confidence),
    ...(new RegExp("(?:publish|send|produce)", "i").test(context.source)
      ? [fact("producer", `${id}:${topic}`, context, { messaging: id, topic }, confidence)]
      : []),
    ...(new RegExp("(?:subscribe|consume)", "i").test(context.source)
      ? [fact("consumer", `${id}:${topic}`, context, { messaging: id, topic }, confidence)]
      : [])
  ]);
}

/** Project boundaries and technology fingerprints are computed after discovery, so mixed-language repositories remain one graph. */
export function buildTechnologyFingerprints(files: Array<{ path: string; language: string; technologyHints?: string[] }>): TechnologyFingerprint[] {
  const markers = /(?:^|\/)(package\.json|pom\.xml|build\.gradle(?:\.kts)?|\.sln|[^/]+\.(?:csproj|vbproj)|pyproject\.toml|go\.mod|cargo\.toml|CMakeLists\.txt)$/i;
  const roots = [...new Set(files.filter(file => markers.test(file.path)).map(file => path.posix.dirname(file.path)))].sort();
  const projectRoots = roots.length ? roots : ["."];
  return projectRoots.map(projectPath => {
    const members = files.filter((file) => nearestProjectRoot(file.path, projectRoots) === projectPath);
    const hints = members.flatMap(file => file.technologyHints ?? []);
    const bucket = (value: string) => [...new Set(hints.filter(hint => hint.startsWith(`${value}:`)).map(hint => hint.slice(value.length + 1)))].sort();
    return { projectPath, name: projectPath === "." ? "workspace" : path.posix.basename(projectPath), languages: [...new Set(members.map(file => file.language))].sort(), runtimes: bucket("runtime"), frameworks: bucket("framework"), persistence: bucket("persistence"), databases: bucket("database"), messaging: bucket("messaging"), contracts: bucket("contract"), packageEcosystems: bucket("package"), buildSystems: bucket("build"), evidencePaths: members.filter(file => markers.test(file.path)).map(file => file.path), confidence: members.length ? 0.85 : 0.4 };
  });
}

function nearestProjectRoot(filePath: string, roots: readonly string[]): string {
  return roots
    .filter((root) => root === "." || filePath.startsWith(`${root}/`) || filePath === root)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0] ?? ".";
}
