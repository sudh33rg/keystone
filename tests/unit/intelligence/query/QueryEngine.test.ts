import { describe, expect, it } from "vitest";
import { SemanticGraphBuilder } from "../../../../src/core/intelligence/semantic/SemanticGraphBuilder";
import {
  CompleteQueryEngine,
  EntityResolver,
  GraphTraversalService,
  QueryContext,
} from "../../../../src/core/intelligence/query/QueryEngine";
import { QueryCompiler } from "../../../../src/core/intelligence/query/QueryParser";
import type { CpgQueryService } from "../../../../src/core/intelligence/cpg/CpgQueryService";
import type { IntelligenceSnapshotReader } from "../../../../src/core/persistence/IntelligenceStore";
import type {
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
} from "../../../../src/shared/contracts/intelligence";
import {
  IntelligenceQuerySchema,
  type IntelligenceQuery,
} from "../../../../src/shared/contracts/query";
import { intelligenceSnapshot } from "../fixtures";

describe("complete deterministic query engine", () => {
  it.each([
    ["find OrderService", "SEARCH"],
    ["where is OrderService used", "USAGES"],
    ["what calls OrderService.create", "DEPENDENTS"],
    ["what does OrderService.create call", "DEPENDENCIES"],
    ["dependencies of orders-module", "DEPENDENCIES"],
    ["dependents of orders-module", "DEPENDENTS"],
    ["path from OrderPage to orders.status", "PATH"],
    ["what is impacted by orders.status", "IMPACT"],
    ["tests for OrderService.create", "TESTS_FOR"],
    ["untested methods in orders", "UNTESTED"],
    ["show order flow", "FLOW"],
    ["show architecture of orders", "ARCHITECTURE"],
    ["show dependency cycles", "CYCLES"],
    ["where is PAYMENT_TIMEOUT used", "CONFIGURATION_USAGE"],
    ["what reads orders", "DATA_USAGE"],
    ["what writes orders", "DATA_USAGE"],
    ["changes to OrderService.create", "CHANGES_TO"],
    ["difference between main and feature", "DIFFERENCE_BETWEEN"],
    ["backward slice from entity:x#node:y", "BACKWARD_SLICE"],
    ["forward slice from entity:x#node:y", "FORWARD_SLICE"],
    ["conditions for entity:x#node:y", "CONDITIONS_FOR"],
  ])("parses %s without an LLM", (text, operation) => {
    const result = new QueryCompiler().compile(text);
    expect(result.parsed).toBe(true);
    expect(result.query?.operation).toBe(operation);
  });
  it("returns a structured diagnostic for unsupported grammar", () => {
    const result = new QueryCompiler().compile("please reason magically about everything");
    expect(result.parsed).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("unsupported-query");
    expect(result.suggestedTemplates.length).toBeGreaterThan(0);
  });
  it("rejects unfilled query templates instead of resolving placeholder text", () => {
    const result = new QueryCompiler().compile("what does <entity> call");
    expect(result.parsed).toBe(false);
    expect(result.rule).toBe("incomplete-template");
    expect(result.diagnostics[0]?.code).toBe("query-placeholder-required");
  });

  it("resolves an exact qualified name with ranking reasons", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("ENTITY", "OrderService.create"));
    expect(result.resolvedSeeds[0]?.selected?.id).toBe("entity:service");
    expect(result.resolvedSeeds[0]?.selected?.reasons).toContain("exact qualified name");
  });
  it("reports ambiguous entity resolution and blocks expensive analysis", async () => {
    const { engine, snapshot } = fixture();
    addEntity(
      snapshot,
      "entity:duplicate",
      "keystone.core.Method",
      "create",
      "OrderService.create",
      "file:service",
      { exported: true },
    );
    snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    const result = await engine.query(query("IMPACT", "create"));
    expect(result.resolvedSeeds[0]?.ambiguous).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "ambiguous-seed")).toBe(true);
  });
  it("reranks search results toward a center entity when centerEntityId is set", async () => {
    const { engine } = fixture();
    const base = query("SEARCH", "Order");
    const plain = await engine.query(base);
    const centered = await engine.query({
      ...base,
      filters: { confidenceAtLeast: 0, centerEntityId: "entity:repository" },
    });
    const centeredItem = centered.data.items.find((item) => item.id === "entity:service");
    const plainItem = plain.data.items.find((item) => item.id === "entity:service");
    expect(centeredItem).toBeDefined();
    expect(plainItem).toBeDefined();
    expect(centeredItem!.score).toBeGreaterThan(plainItem!.score);
    expect(centeredItem!.rankingReasons.some((reason) => reason.includes("graph distance"))).toBe(
      true,
    );
  });
  it("ignores centerEntityId for unreachable or unknown centers", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("SEARCH", "Order"),
      filters: { confidenceAtLeast: 0, centerEntityId: "entity:does-not-exist" },
    });
    expect(result.data.items.length).toBeGreaterThan(0);
    expect(
      result.data.items.every(
        (item) => !item.rankingReasons.some((reason) => reason.includes("graph distance")),
      ),
    ).toBe(true);
  });
  it("searches qualified names and paginates through bounded limits", async () => {
    const { engine } = fixture();
    const first = await engine.query({
      ...query("SEARCH", "Order"),
      limits: { ...limits(), results: 2 },
    });
    expect(first.data.items).toHaveLength(2);
    expect(first.truncated).toBe(true);
    expect(first.continuationToken).toBe("2");
    const second = await engine.query({
      ...query("SEARCH", "Order"),
      limits: { ...limits(), results: 2, cursor: first.continuationToken },
    });
    expect(second.data.items.map((item) => item.id)).not.toEqual(
      first.data.items.map((item) => item.id),
    );
  });
  it("returns only an exact stable-ID match and tokenizes CamelCase names", async () => {
    const { engine } = fixture();
    const exact = await engine.query(query("SEARCH", "entity:service"));
    expect(exact.data.items.map((item) => item.id)).toEqual(["entity:service"]);
    const token = await engine.query(query("SEARCH", "Service"));
    expect(token.data.items.some((item) => item.id === "entity:service")).toBe(true);
  });
  it("filters search by entity type", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("SEARCH", "orders"),
      filters: { entityTypes: ["keystone.core.Table"], confidenceAtLeast: 0 },
    });
    expect(result.data.items.every((item) => item.type === "keystone.core.Table")).toBe(true);
  });

  it("returns direct classified usages without transitive dependency expansion", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("USAGES", "OrderService.create"));
    expect(result.data.items.map((item) => [item.id, item.group])).toEqual(
      expect.arrayContaining([
        ["entity:handler", "called-by"],
        ["entity:test", "tested-by"],
      ]),
    );
    expect(result.data.items.some((item) => item.id === "entity:page")).toBe(false);
    expect(result.data.sections.production?.some((item) => item.id === "entity:handler")).toBe(
      true,
    );
    expect(result.data.sections.tests?.some((item) => item.id === "entity:test")).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
  });
  it("requires explicit selection for ambiguous usage seeds", async () => {
    const { engine, snapshot } = fixture();
    addEntity(
      snapshot,
      "entity:duplicate",
      "keystone.core.Method",
      "create",
      "OtherService.create",
      "file:service",
      { exported: true },
    );
    snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    const result = await engine.query(query("USAGES", "create"));
    expect(result.resolvedSeeds[0]?.requiresSelection).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "ambiguous-seed")).toBe(true);
    expect(result.data.items).toEqual([]);
  });
  it("deduplicates repeated physical edges into one logical usage and preserves evidence", async () => {
    const { engine, snapshot } = fixture();
    const original = snapshot.relationships.find(
      (item) => item.sourceId === "entity:handler" && item.targetId === "entity:service",
    )!;
    const evidenceId = "evidence:duplicate-call";
    snapshot.relationships.push({
      ...original,
      id: `${original.id}:duplicate`,
      evidenceIds: [evidenceId],
    });
    snapshot.evidence.push(
      evidence(
        evidenceId,
        `${original.id}:duplicate`,
        "api/routes.ts",
        snapshot.manifest.generation,
        "keystone.typescript",
      ),
    );
    snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    const result = await engine.query(query("USAGES", "OrderService.create"));
    const usage = result.data.items.find(
      (item) => item.id === "entity:handler" && item.group === "called-by",
    )!;
    expect(usage.details?.physicalOccurrenceCount).toBe(2);
    expect(usage.details?.evidenceIds).toEqual(
      expect.arrayContaining([original.evidenceIds[0], evidenceId]),
    );
    expect(
      result.data.items.filter(
        (item) => item.id === "entity:handler" && item.group === "called-by",
      ),
    ).toHaveLength(1);
  });
  it("paginates usages deterministically and distinguishes candidate relationships", async () => {
    const { engine, snapshot } = fixture();
    addRelation(snapshot, "entity:repository", "entity:service", "keystone.core.REFERENCES", 0.6);
    snapshot.relationships.at(-1)!.resolution = "candidate";
    snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    const first = await engine.query({
      ...query("USAGES", "OrderService.create"),
      limits: { ...limits(), results: 2 },
    });
    expect(first.data.items).toHaveLength(2);
    expect(first.continuationToken).toBe("2");
    expect(first.data.metrics.candidates).toBe(1);
    const second = await engine.query({
      ...query("USAGES", "OrderService.create"),
      limits: { ...limits(), results: 2, cursor: first.continuationToken },
    });
    expect(second.data.items.map((item) => item.id)).not.toEqual(
      first.data.items.map((item) => item.id),
    );
  });
  it("exposes a bounded inspectable usage query plan", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("USAGES", "OrderService.create"));
    expect(result.plan).toMatchObject({
      operation: "USAGES",
      resolvedSeedIds: ["entity:service"],
      indexesSelected: ["entity-scan", "incoming-adjacency", "relationship-type"],
      traversalDirection: "incoming",
      maximumDepth: 1,
      cpgRequired: false,
      evidenceRequired: true,
      timeBudgetMs: 1000,
    });
    expect(result.plan.relationshipFamilies).toContain("keystone.core.CALLS");
  });

  it.each([
    ["incoming", "entity:test"],
    ["outgoing", "entity:repository"],
    ["both", "entity:handler"],
  ] as const)("supports %s traversal", async (direction, expected) => {
    const { snapshot } = fixture();
    const compiled = IntelligenceQuerySchema.parse({
      ...query("NEIGHBORHOOD", "OrderService.create"),
      traversal: { direction, maxDepth: 2, pathMode: "shortest" },
    });
    const context = new QueryContext(compiled, snapshot);
    const resolved = await new EntityResolver().resolve(compiled, context);
    const result = await new GraphTraversalService().traverse(context, [resolved[0]!.selected!.id]);
    expect(result.nodes.some((item) => item.id === expected)).toBe(true);
  });
  it("enforces traversal depth", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("NEIGHBORHOOD", "OrderPage"),
      traversal: { direction: "outgoing", maxDepth: 1, pathMode: "shortest" },
      limits: { ...limits(), depth: 1 },
    });
    expect(result.data.nodes.some((item) => item.id === "entity:service")).toBe(false);
  });
  it("enforces traversal node limits", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("NEIGHBORHOOD", "OrderService.create"),
      limits: { ...limits(), nodes: 2 },
    });
    expect(result.data.nodes.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });
  it("filters relationships by confidence", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("NEIGHBORHOOD", "OrderService.create"),
      filters: { confidenceAtLeast: 0.9 },
    });
    expect(result.data.relationships.every((item) => item.confidence >= 0.9)).toBe(true);
  });

  it("finds the shortest cross-technology path with ordered evidence", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...pathQuery("OrderPage", "orders.status"),
      limits: { ...limits(), depth: 10 },
    });
    expect(result.data.paths[0]?.steps.map((item) => item.entityId)).toEqual([
      "entity:page",
      "entity:client",
      "entity:route",
      "entity:handler",
      "entity:service",
      "entity:repository",
      "entity:column",
    ]);
    expect(result.data.paths[0]?.steps.at(-1)?.evidenceIds.length).toBeGreaterThan(0);
    expect(result.explanation.capabilityBoundaries.some((item) => item.includes("sql"))).toBe(true);
  });
  it("supports typed path constraints", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...pathQuery("OrderService.create", "orders.status"),
      filters: {
        relationshipTypes: ["keystone.core.CALLS", "keystone.core.WRITES_TO"],
        confidenceAtLeast: 0,
      },
    });
    expect(
      result.data.paths[0]?.steps.map((step) => step.relationshipType).filter(Boolean),
    ).toEqual(["keystone.core.CALLS", "keystone.core.WRITES_TO"]);
  });
  it("returns an honest no-path result without fabricated hops", async () => {
    const { engine } = fixture();
    const result = await engine.query(pathQuery("OrderPage", "OrderConsumer"));
    expect(result.data.paths).toEqual([]);
    expect(result.evidence).toEqual([]);
  });
  it("bounds all-path exploration", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...pathQuery("OrderPage", "orders.status"),
      traversal: { direction: "both", maxDepth: 10, pathMode: "all-bounded" },
      limits: { ...limits(), paths: 1, depth: 10 },
    });
    expect(result.data.paths).toHaveLength(1);
  });

  it.each([
    ["orders.status", "data"],
    ["POST /orders", "contract"],
    ["PAYMENT_TIMEOUT", "behavioral"],
  ] as const)("classifies %s impact into %s sections", async (seed, section) => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("IMPACT", seed),
      limits: { ...limits(), depth: 8 },
    });
    expect(result.data.sections[section]!.length).toBeGreaterThan(0);
  });
  it("distinguishes direct and transitive impact", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("IMPACT", "orders.status"),
      limits: { ...limits(), depth: 8 },
    });
    expect(result.data.sections.direct!.some((item) => item.id === "entity:repository")).toBe(true);
    expect(result.data.sections.transitive!.some((item) => item.id === "entity:service")).toBe(
      true,
    );
  });
  it("includes impacted tests and explained risk factors", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("IMPACT", "OrderService.create"),
      limits: { ...limits(), depth: 4 },
    });
    expect(result.data.sections.tests!.some((item) => item.id === "entity:test")).toBe(true);
    expect(result.data.items.some((item) => Array.isArray(item.details?.riskFactors))).toBe(true);
  });

  it("reconstructs an ordered HTTP persistence flow without filling missing segments", async () => {
    const { engine } = fixture();
    const result = await engine.query({
      ...query("FLOW", "OrderPage"),
      limits: { ...limits(), depth: 10 },
    });
    const path = result.data.paths.find((item) => item.steps.at(-1)?.entityId === "entity:column");
    expect(path?.steps.map((step) => step.entityId)).toEqual([
      "entity:page",
      "entity:client",
      "entity:route",
      "entity:handler",
      "entity:service",
      "entity:repository",
      "entity:column",
    ]);
    expect(path?.flow).toMatchObject({
      templateId: "http-persistence",
      status: "complete",
      missingStages: [],
    });
    expect(path?.flow?.matchedStages).toEqual(
      expect.arrayContaining(["API target", "route handler", "data access"]),
    );
    expect(path?.flow?.alternateRank).toBeGreaterThan(0);
    expect(
      path?.steps
        .slice(1)
        .every(
          (step) =>
            step.relationshipId &&
            step.evidenceIds.length > 0 &&
            step.traversalDirection === "outgoing",
        ),
    ).toBe(true);
  });
  it("reconstructs an event producer-consumer flow", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("FLOW", "OrderProducer"));
    expect(result.data.paths[0]?.steps.map((item) => item.entityId)).toEqual([
      "entity:producer",
      "entity:event",
      "entity:consumer",
    ]);
    expect(result.data.paths[0]?.flow).toMatchObject({
      templateId: "event",
      status: "complete",
      missingStages: [],
    });
  });
  it("reconstructs command and build-pipeline flows with separate templates", async () => {
    const { engine } = fixture();
    const command = await engine.query(query("FLOW", "OrderService.create"));
    expect(command.data.paths[0]?.flow).toMatchObject({
      templateId: "command-execution",
      status: "complete",
    });
    const build = await engine.query(query("FLOW", "release-pipeline"));
    expect(build.data.paths[0]?.steps.map((item) => item.entityId)).toEqual([
      "entity:pipeline",
      "entity:build",
      "entity:artifact",
    ]);
    expect(build.data.paths[0]?.flow).toMatchObject({
      templateId: "build-pipeline",
      status: "complete",
      missingStages: [],
    });
  });
  it("traverses configuration usage in the evidenced reverse direction", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("FLOW", "PAYMENT_TIMEOUT"));
    const path = result.data.paths[0]!;
    expect(path.flow).toMatchObject({ templateId: "configuration", status: "complete" });
    expect(path.steps.slice(0, 2).map((item) => item.entityId)).toEqual([
      "entity:config",
      "entity:service",
    ]);
    expect(path.steps[1]).toMatchObject({
      relationshipType: "keystone.core.USES_CONFIGURATION",
      traversalDirection: "incoming",
    });
  });
  it("reports the exact missing flow stage and never jumps across an absent hop", async () => {
    const { engine, snapshot } = fixture();
    snapshot.relationships = snapshot.relationships.filter(
      (item) => !(item.sourceId === "entity:client" && item.type === "keystone.core.TARGETS"),
    );
    snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    const result = await engine.query(query("FLOW", "OrderPage"));
    expect(result.data.paths[0]?.flow?.status).toBe("partial");
    expect(result.data.paths[0]?.flow?.missingStages).toContain("API target");
    expect(
      result.data.paths
        .flatMap((path) => path.steps)
        .some((step) => step.entityId === "entity:handler"),
    ).toBe(false);
    expect(result.data.paths[0]?.flow?.terminalReason).toMatch(/No evidence-backed API target/);
  });
  it("ranks complete alternate flows by visible deterministic evidence signals", async () => {
    const { engine, snapshot } = fixture();
    addRelation(snapshot, "entity:client", "entity:route", "keystone.core.TARGETS", 0.55);
    snapshot.relationships.at(-1)!.id += ":alternate";
    snapshot.evidence.at(-1)!.subjectId = snapshot.relationships.at(-1)!.id;
    snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    const result = await engine.query({
      ...query("FLOW", "OrderPage"),
      limits: { ...limits(), paths: 5, depth: 10 },
    });
    expect(result.data.paths.length).toBeGreaterThan(2);
    expect(result.data.paths[0]?.flow?.score).toBeGreaterThan(
      result.data.paths.at(-1)?.flow?.score ?? 0,
    );
    expect(result.data.paths.map((path) => path.flow?.alternateRank)).toEqual(
      result.data.paths.map((_, index) => index + 1),
    );
    expect(result.data.paths.at(-1)?.flow?.scoreReasons.join(" ")).toContain(
      "minimum relationship confidence 55%",
    );
  });
  it("honors relationship filters and depth bounds while reconstructing flows", async () => {
    const { engine } = fixture();
    const filtered = await engine.query({
      ...query("FLOW", "OrderPage"),
      filters: { relationshipTypes: ["keystone.core.TARGETS"], confidenceAtLeast: 0 },
    });
    expect(filtered.data.paths[0]?.steps).toHaveLength(1);
    expect(filtered.data.paths[0]?.flow?.status).toBe("partial");
    const bounded = await engine.query({
      ...query("FLOW", "OrderPage"),
      limits: { ...limits(), depth: 2 },
    });
    expect(bounded.data.paths[0]?.truncated).toBe(true);
    expect(bounded.data.paths[0]?.flow?.missingStages).toContain("route handler");
  });
  it("reports unsupported flow starts instead of falling back to a broad graph walk", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("FLOW", "orders.status"));
    expect(result.data.paths).toEqual([]);
    expect(
      result.diagnostics.some(
        (item) => item.code === "flow-template-unavailable" && item.limitation,
      ),
    ).toBe(true);
  });
  it("answers dependency and reverse-dependency queries with evidence", async () => {
    const { engine } = fixture();
    const deps = await engine.query(query("DEPENDENCIES", "orders-module"));
    const reverse = await engine.query(query("DEPENDENTS", "orders-package"));
    expect(deps.data.items.some((item) => item.id === "entity:package")).toBe(true);
    expect(reverse.data.items.some((item) => item.id === "entity:module")).toBe(true);
    expect(deps.evidence.length).toBeGreaterThan(0);
  });

  it("detects evidenced dependency cycles, centrality, layer violations, and dead-code candidates", async () => {
    const { engine } = fixture();
    const cycles = await engine.query({
      ...queryNoSeed("CYCLES"),
      limits: { ...limits(), depth: 6 },
    });
    const architecture = await engine.query(queryNoSeed("ARCHITECTURE"));
    expect(cycles.data.paths.length).toBeGreaterThan(0);
    expect(
      cycles.data.paths[0]?.steps
        .slice(1)
        .every((step) => step.relationshipType && step.evidenceIds.length),
    ).toBe(true);
    expect(cycles.evidence.length).toBeGreaterThan(0);
    expect(architecture.data.sections.central!.length).toBeGreaterThan(0);
    expect(architecture.data.sections.violations!.length).toBeGreaterThan(0);
    expect(
      architecture.data.sections.deadCodeCandidates!.every(
        (item) => item.classification === "candidate",
      ),
    ).toBe(true);
  });
  it("ranks tests-for by exact resolved mapping", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("TESTS_FOR", "OrderService.create"));
    expect(result.data.items[0]?.id).toBe("entity:test");
    expect(result.data.items[0]?.rankingReasons[0]).toMatch(/exact|coverage/);
  });
  it("reports untested public symbols and CPG branches as candidates", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("UNTESTED", "orders-package"));
    expect(
      result.data.items.some(
        (item) => item.id === "entity:cancel" && item.group === "untested-public-symbol",
      ),
    ).toBe(true);
    expect(
      result.data.items.some(
        (item) => item.id === "entity:cancel" && item.group === "untested-cpg-branch",
      ),
    ).toBe(true);
  });

  it("exposes SECURITY_SCAN with attack-surface sections and metrics", async () => {
    const { engine } = fixture();
    const result = await engine.query(queryNoSeed("SECURITY_SCAN"));
    expect(result.data.kind).toBe("security-scan");
    expect(result.data.sections.attackSurface).toBeDefined();
    expect(result.data.sections.sensitiveData).toBeDefined();
    expect(result.data.metrics.attackSurfaceEntries).toBeGreaterThanOrEqual(0);
    expect(result.data.metrics.scannedEntryPoints).toBeGreaterThan(0);
  });

  it("SECURITY_SCAN requires no seed and is reachable via the natural-language parser", () => {
    const parsed = new QueryCompiler().compile("security scan", { generation: 2 });
    expect(parsed.query?.operation).toBe("SECURITY_SCAN");
  });

  it("compares retained generations for signature, route, and schema changes", async () => {
    const setup = fixture();
    const previous = cloneGeneration(setup.snapshot, 1, "main");
    mutate(setup.snapshot, "entity:service", (item) => {
      item.signature = "(input: NewOrder): Promise<Order>";
    });
    mutate(setup.snapshot, "entity:route", (item) => {
      item.properties = { ...item.properties, path: "/v2/orders" };
    });
    mutate(setup.snapshot, "entity:column", (item) => {
      item.properties = { ...item.properties, nullable: true };
    });
    setup.retained.push(previous);
    const result = await setup.engine.query(query("CHANGES_TO", "OrderService.create"));
    expect(result.data.items[0]?.group).toBe("signature-change");
    const all = await setup.engine.query(
      queryNoSeed("DIFFERENCE_BETWEEN", { branch: "main", compareTo: "feature" }),
    );
    expect(all.data.items.map((item) => item.group)).toEqual(
      expect.arrayContaining(["signature-change", "route-change", "schema-change"]),
    );
  });
  it("reports unavailable branch comparison honestly", async () => {
    const { engine } = fixture();
    const result = await engine.query(
      queryNoSeed("DIFFERENCE_BETWEEN", { branch: "missing", compareTo: "feature" }),
    );
    expect(
      result.diagnostics.some(
        (item) => item.code === "temporal-state-unavailable" && item.limitation,
      ),
    ).toBe(true);
  });

  it("integrates CPG scope and reports unavailable slices without invention", async () => {
    const { engine } = fixture();
    const scope = await engine.query(query("CPG_SCOPE", "OrderService.create"));
    expect(scope.diagnostics.some((item) => item.code === "cpg-scope-unavailable")).toBe(true);
    const slice = await engine.query(query("BACKWARD_SLICE", "OrderService.create"));
    expect(slice.diagnostics.some((item) => item.code === "cpg-node-required")).toBe(true);
  });
  it.each(["BACKWARD_SLICE", "FORWARD_SLICE", "CONDITIONS_FOR"] as const)(
    "routes %s through the CPG facade when an explicit node is supplied",
    async (operation) => {
      const { engine } = fixture();
      const result = await engine.query(query(operation, "entity:service#node:branch"));
      expect(result.resolvedSeeds[0]?.selected?.id).toBe("entity:service");
      expect(result.diagnostics.some((item) => item.code === "cpg-node-required")).toBe(false);
      expect(result.diagnostics.some((item) => item.code === "cpg-scope-unavailable")).toBe(true);
    },
  );
  it("explains compilation, indexes, relationship families, and ranking weights", async () => {
    const { engine } = fixture();
    const result = await engine.query(
      query("DEPENDENCIES", "OrderService.create"),
      undefined,
      "dependencies",
    );
    expect(result.explanation.parserRule).toBe("dependencies");
    expect(result.explanation.indexesUsed).toContain("outgoing");
    expect(result.explanation.relationshipFamilies).toContain("keystone.core.CALLS");
    expect(result.explanation.rankingRules.some((item) => item.startsWith("exactId="))).toBe(true);
  });
  it("supports cancellation and time-budget enforcement", async () => {
    const setup = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      setup.engine.query(queryNoSeed("ARCHITECTURE"), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    const compiled = IntelligenceQuerySchema.parse(queryNoSeed("ARCHITECTURE"));
    const context = new QueryContext(compiled, setup.snapshot);
    (context as { deadline: number }).deadline = 0;
    expect(() => context.check()).toThrow(/time budget/i);
  });
  it("hits generation-specific cache and prevents stale-generation results", async () => {
    const setup = fixture();
    const first = await setup.engine.query(query("DEPENDENCIES", "OrderService.create"));
    const second = await setup.engine.query(query("DEPENDENCIES", "OrderService.create"));
    expect(first.cacheState).toBe("miss");
    expect(second.cacheState).toBe("hit");
    const stale = await setup.engine.query({ ...query("SEARCH", "Order"), generation: 1 });
    expect(stale.diagnostics[0]?.code).toBe("generation-unavailable");
  });
  it("invalidates cache after generation change", async () => {
    const setup = fixture();
    await setup.engine.query(query("DEPENDENCIES", "OrderService.create"));
    setup.snapshot.manifest.generation = 3;
    setup.snapshot.symbols.forEach((item) => {
      item.generation = 3;
    });
    setup.snapshot.relationships.forEach((item) => {
      item.generation = 3;
    });
    setup.snapshot.evidence.forEach((item) => {
      item.generation = 3;
    });
    const result = await setup.engine.query(query("DEPENDENCIES", "OrderService.create"));
    expect(result.cacheState).toBe("miss");
    expect(result.generation).toBe(3);
  });
  it("keeps every Webview-facing collection bounded", async () => {
    const { engine } = fixture();
    const result = await engine.query(queryNoSeed("ARCHITECTURE"));
    expect(result.data.items.length).toBeLessThanOrEqual(100);
    expect(result.data.nodes.length).toBeLessThanOrEqual(500);
    expect(result.data.relationships.length).toBeLessThanOrEqual(1500);
    expect(result.evidence.length).toBeLessThanOrEqual(100);
  });
});

function fixture() {
  const snapshot = mixedSnapshot();
  const retained: IntelligenceSnapshot[] = [];
  const store: IntelligenceSnapshotReader = {
    getSnapshot: () => snapshot,
    isStorageAvailable: () => true,
    getLoadError: () => undefined,
    getRetainedSnapshots: () => Promise.resolve([snapshot, ...retained]),
  };
  const cpg = {
    scope: () => Promise.resolve(undefined),
    controlFlow: () => Promise.resolve(undefined),
    dataFlow: () => Promise.resolve(undefined),
    slice: () => Promise.resolve(undefined),
    conditionsForNode: () => Promise.resolve(undefined),
  } as unknown as CpgQueryService;
  return { snapshot, retained, engine: new CompleteQueryEngine(store, cpg) };
}

function mixedSnapshot(): IntelligenceSnapshot {
  const snapshot = intelligenceSnapshot(2);
  snapshot.repository.branch = "feature";
  snapshot.repository.headCommit = "head-feature";
  for (const [id, path, language, category] of [
    ["file:page", "ui/OrderPage.tsx", "typescriptreact", "source"],
    ["file:client", "ui/api.ts", "typescript", "source"],
    ["file:route", "api/routes.ts", "typescript", "source"],
    ["file:service", "api/OrderService.ts", "typescript", "source"],
    ["file:repo", "data/OrderRepository.ts", "typescript", "source"],
    ["file:schema", "db/schema.sql", "sql", "schema"],
    ["file:test", "tests/order.test.ts", "typescript", "test"],
    ["file:config", "config/app.yaml", "yaml", "configuration"],
    ["file:package", "package.json", "json", "manifest"],
  ] as const)
    addFile(snapshot, id, path, language, category);
  addEntity(
    snapshot,
    "entity:page",
    "keystone.core.Component",
    "OrderPage",
    "OrderPage",
    "file:page",
    { exported: true, layer: "presentation" },
  );
  addEntity(
    snapshot,
    "entity:client",
    "keystone.core.Function",
    "createOrder",
    "api.createOrder",
    "file:client",
    { exported: true, layer: "presentation" },
  );
  addEntity(
    snapshot,
    "entity:route",
    "keystone.core.Route",
    "POST /orders",
    "POST /orders",
    "file:route",
    { method: "POST", path: "/orders", layer: "application" },
  );
  addEntity(
    snapshot,
    "entity:handler",
    "keystone.core.Function",
    "createOrderHandler",
    "createOrderHandler",
    "file:route",
    { exported: true, layer: "application" },
  );
  addEntity(
    snapshot,
    "entity:service",
    "keystone.core.Method",
    "create",
    "OrderService.create",
    "file:service",
    { exported: true, layer: "application" },
    "(input: OrderInput): Promise<Order>",
  );
  addEntity(
    snapshot,
    "entity:repository",
    "keystone.core.Method",
    "save",
    "OrderRepository.save",
    "file:repo",
    { exported: true, layer: "data" },
  );
  addEntity(
    snapshot,
    "entity:table",
    "keystone.core.Table",
    "orders",
    "public.orders",
    "file:schema",
    { tableName: "orders", layer: "data" },
  );
  addEntity(
    snapshot,
    "entity:column",
    "keystone.core.Column",
    "status",
    "orders.status",
    "file:schema",
    { tableName: "orders", columnName: "status", nullable: false, layer: "data" },
  );
  addEntity(
    snapshot,
    "entity:test",
    "keystone.core.TestCase",
    "creates order",
    "orders creates order",
    "file:test",
    { framework: "vitest" },
  );
  addEntity(
    snapshot,
    "entity:config",
    "keystone.core.ConfigurationKey",
    "PAYMENT_TIMEOUT",
    "PAYMENT_TIMEOUT",
    "file:config",
    { keyPath: "PAYMENT_TIMEOUT" },
  );
  addEntity(
    snapshot,
    "entity:package",
    "keystone.core.Package",
    "orders-package",
    "orders-package",
    "file:package",
    { packageName: "orders-package" },
  );
  addEntity(
    snapshot,
    "entity:module",
    "keystone.core.Module",
    "orders-module",
    "orders-module",
    "file:service",
    { layer: "application" },
  );
  addEntity(
    snapshot,
    "entity:producer",
    "keystone.core.Producer",
    "OrderProducer",
    "OrderProducer",
    "file:service",
    {},
  );
  addEntity(
    snapshot,
    "entity:event",
    "keystone.core.Event",
    "OrderCreated",
    "OrderCreated",
    "file:service",
    {},
  );
  addEntity(
    snapshot,
    "entity:consumer",
    "keystone.core.Consumer",
    "OrderConsumer",
    "OrderConsumer",
    "file:service",
    {},
  );
  addEntity(
    snapshot,
    "entity:pipeline",
    "keystone.core.Pipeline",
    "release-pipeline",
    "release-pipeline",
    "file:package",
    {},
  );
  addEntity(
    snapshot,
    "entity:build",
    "keystone.core.BuildCommand",
    "build:extension",
    "build:extension",
    "file:package",
    {},
  );
  addEntity(
    snapshot,
    "entity:artifact",
    "keystone.core.Artifact",
    "extension.js",
    "dist/extension.js",
    "file:package",
    {},
  );
  addEntity(
    snapshot,
    "entity:cancel",
    "keystone.core.Method",
    "cancel",
    "OrderService.cancel",
    "file:service",
    { exported: true, layer: "application" },
  );
  snapshot.symbols.find((item) => item.id === "entity:cancel")!.codeAnalysis = {
    scopeId: "scope:cancel",
    structuralHash: "hash",
    providerId: "keystone.typescript-cpg",
    providerVersion: "1",
    calculationMethod: "summary",
    confidence: 1,
    evidenceIds: snapshot.symbols.find((item) => item.id === "entity:cancel")!.evidenceIds,
    branches: 3,
    calls: 0,
    reads: 1,
    writes: 0,
    unresolvedCalls: 0,
  };
  for (const [source, target, type, confidence] of [
    ["entity:page", "entity:client", "keystone.core.CALLS", 1],
    ["entity:client", "entity:route", "keystone.core.TARGETS", 1],
    ["entity:route", "entity:handler", "keystone.core.ROUTES_TO", 1],
    ["entity:handler", "entity:service", "keystone.core.CALLS", 1],
    ["entity:service", "entity:repository", "keystone.core.CALLS", 1],
    ["entity:repository", "entity:table", "keystone.core.WRITES_TO", 1],
    ["entity:repository", "entity:column", "keystone.core.WRITES_TO", 1],
    ["entity:test", "entity:service", "keystone.core.TESTS", 1],
    ["entity:service", "entity:config", "keystone.core.USES_CONFIGURATION", 1],
    ["entity:module", "entity:package", "keystone.core.DEPENDS_ON", 1],
    ["entity:package", "entity:module", "keystone.core.DEPENDS_ON", 0.8],
    ["entity:producer", "entity:event", "keystone.core.EMITS", 1],
    ["entity:event", "entity:consumer", "keystone.core.HANDLES", 1],
    ["entity:pipeline", "entity:build", "keystone.core.RUNS_BUILD_COMMAND", 1],
    ["entity:build", "entity:artifact", "keystone.core.PRODUCES_ARTIFACT", 1],
    ["entity:repository", "entity:page", "keystone.core.DEPENDS_ON", 0.7],
  ] as const)
    addRelation(snapshot, source, target, type, confidence);
  snapshot.manifest.extractorVersions = {
    "keystone.typescript": "3",
    "keystone.adapter.database": "1",
    "keystone.typescript-cpg": "1",
  };
  snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
  return snapshot;
}

function addFile(
  snapshot: IntelligenceSnapshot,
  id: string,
  relativePath: string,
  language: string,
  category: IntelligenceFileRecord["category"],
): void {
  const evidenceId = `evidence:${id}`;
  snapshot.files.push({
    ...snapshot.files[0]!,
    id,
    relativePath,
    language,
    category,
    contentHash: `hash:${id}`,
    evidenceIds: [evidenceId],
    generation: snapshot.manifest.generation,
  });
  snapshot.evidence.push(
    evidence(
      evidenceId,
      id,
      relativePath,
      snapshot.manifest.generation,
      language === "sql" ? "keystone.adapter.database" : "keystone.typescript",
    ),
  );
}
function addEntity(
  snapshot: IntelligenceSnapshot,
  id: string,
  type: string,
  name: string,
  qualifiedName: string,
  fileId: string,
  properties: Record<string, string | number | boolean | string[]>,
  signature?: string,
): void {
  const file = snapshot.files.find((item) => item.id === fileId)!;
  const evidenceId = `evidence:${id}`;
  snapshot.symbols.push({
    id,
    repositoryId: snapshot.repository.id,
    fileId,
    ownerFileId: fileId,
    type,
    name,
    qualifiedName,
    language: file.language,
    ...(signature ? { signature } : {}),
    range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 },
    properties,
    exported: properties.exported === true,
    visibility: properties.exported === true ? "public" : undefined,
    evidenceIds: [evidenceId],
    confidence: 1,
    generation: snapshot.manifest.generation,
  });
  snapshot.evidence.push(
    evidence(
      evidenceId,
      id,
      file.relativePath,
      snapshot.manifest.generation,
      file.language === "sql" ? "keystone.adapter.database" : "keystone.typescript",
    ),
  );
}
function addRelation(
  snapshot: IntelligenceSnapshot,
  sourceId: string,
  targetId: string,
  type: string,
  confidence: number,
): void {
  const id = `relationship:${sourceId}:${type}:${targetId}`;
  const source = snapshot.symbols.find((item) => item.id === sourceId)!;
  const target = snapshot.symbols.find((item) => item.id === targetId)!;
  const file = snapshot.files.find((item) => item.id === source.fileId)!;
  const evidenceId = `evidence:${id}`;
  snapshot.relationships.push({
    id,
    repositoryId: snapshot.repository.id,
    sourceId,
    targetId,
    type,
    ownerFileId: source.fileId,
    targetFileId: target.fileId,
    resolution: confidence === 1 ? "exact" : "convention",
    evidenceIds: [evidenceId],
    derivation: confidence === 1 ? "resolved" : "calculated",
    confidence,
    generation: snapshot.manifest.generation,
  });
  snapshot.evidence.push(
    evidence(
      evidenceId,
      id,
      file.relativePath,
      snapshot.manifest.generation,
      file.language === "sql" ? "keystone.adapter.database" : "keystone.typescript",
    ),
  );
}
function evidence(
  id: string,
  subjectId: string,
  relativePath: string,
  generation: number,
  extractorId: string,
): IntelligenceEvidenceRecord {
  return {
    id,
    subjectId,
    sourceKind: extractorId.includes("adapter") ? "adapter" : "typescript-compiler",
    workspaceRootId: "workspace-root:fixture",
    relativePath,
    extractorId,
    extractorVersion: "1",
    derivation: "extracted",
    generation,
    confidence: 1,
    statement: `${subjectId} is evidenced by ${relativePath}.`,
  };
}
function limits() {
  return {
    results: 25,
    nodes: 100,
    edges: 300,
    paths: 5,
    depth: 8,
    evidence: 30,
    timeBudgetMs: 1000,
  };
}
function query(operation: IntelligenceQuery["operation"], value: string): IntelligenceQuery {
  return {
    operation,
    seeds: [
      {
        value,
        kind: operation.includes("SLICE") || operation === "CONDITIONS_FOR" ? "cpg-node" : "name",
      },
    ],
    limits: limits(),
  };
}
function pathQuery(source: string, target: string): IntelligenceQuery {
  return {
    operation: "PATH",
    seeds: [
      { value: source, kind: "name" },
      { value: target, kind: "name" },
    ],
    traversal: { direction: "outgoing", maxDepth: 8, pathMode: "shortest" },
    limits: limits(),
  };
}
function queryNoSeed(
  operation: IntelligenceQuery["operation"],
  filters: Record<string, unknown> = {},
): IntelligenceQuery {
  return { operation, filters: { ...filters, confidenceAtLeast: 0 }, limits: limits() };
}
function cloneGeneration(
  snapshot: IntelligenceSnapshot,
  generation: number,
  branch: string,
): IntelligenceSnapshot {
  const value = structuredClone(snapshot);
  value.manifest.generation = generation;
  value.repository.branch = branch;
  value.symbols.forEach((item) => {
    item.generation = generation;
  });
  value.relationships.forEach((item) => {
    item.generation = generation;
  });
  value.evidence.forEach((item) => {
    item.generation = generation;
  });
  return value;
}
function mutate(
  snapshot: IntelligenceSnapshot,
  id: string,
  callback: (item: IntelligenceSymbolRecord) => void,
): void {
  callback(snapshot.symbols.find((item) => item.id === id)!);
}
