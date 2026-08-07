import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationStore } from "@core/application/applicationStore";
import {
  compressDiagnostics,
  compressDiff,
  compressDocumentation,
  compressSourceCode,
  compressStructuredData
} from "@core/context/taskAwareCompression";
import { estimateTokens } from "@core/context/tokenEstimator";
import { selectIntentPrimaryAction } from "@core/intent/primaryAction";
import { analyzeArtifact, enrichEcosystem } from "@core/intelligence/ecosystem/registries";
import { detectEngineeringEntities } from "@core/intelligence/ingestion/engineeringEntityDetector";
import { LANGUAGE_DEFINITIONS, LanguageCapabilityRegistry } from "@core/intelligence/languages/languageRegistry";
import {
  MAX_LANGUAGE_SERVICE_SYMBOLS_PER_DOCUMENT,
  boundSemanticSymbols
} from "@core/intelligence/languages/semanticSymbolBudget";
import { repoIntelligenceToOkf } from "@core/intelligence/okf/fromRepoIntelligence";
import { decryptHandoffPackage, encryptHandoffPackage } from "@core/workflow/handoff/handoffSecurity";
import { parseValidationOutput } from "@core/workflow/validation/validationParser";

test("application state snapshots are isolated and versioned", () => {
  const store = new ApplicationStore({ workspace: { name: "repo", root: "/repo" } });
  const first = store.snapshot();
  const next = store.update({ status: "ready" });

  assert.equal(first.version, 1);
  assert.equal(next.version, 2);
  assert.equal(first.status, "idle");
  assert.equal(store.snapshot().status, "ready");
});

test("registered major languages are identifiable with honest capability tiers", () => {
  const registry = new LanguageCapabilityRegistry();
  assert.equal(LANGUAGE_DEFINITIONS.length, 44);
  assert.equal(registry.identify("src/app.tsx")?.id, "typescript");
  assert.equal(registry.identify("service.py")?.id, "python");
  assert.equal(registry.identify("api/Controller.java")?.id, "java");
  assert.equal(registry.identify("Dockerfile")?.id, "dockerfile");
  assert.equal(registry.identify("charts/app/values.yaml")?.id, "kubernetes");
  assert.equal(registry.identify("unknown.custom"), undefined);
  assert.equal(registry.identify("main.ts")?.capabilities.calls, "deep");
  assert.equal(registry.identify("main.py")?.capabilities.calls, "structural");
});

test("language-service semantic queries are bounded per document", () => {
  const input = Array.from(
    { length: MAX_LANGUAGE_SERVICE_SYMBOLS_PER_DOCUMENT + 4 },
    (_, index) => index
  );
  const bounded = boundSemanticSymbols(input);
  assert.equal(bounded.symbols.length, MAX_LANGUAGE_SERVICE_SYMBOLS_PER_DOCUMENT);
  assert.equal(bounded.truncated, 4);
  assert.deepEqual(boundSemanticSymbols(input, 2), { symbols: [0, 1], truncated: input.length - 2 });
});

test("context compression preserves relevant source and respects a bounded budget", () => {
  const source = [
    "const noise = 1;",
    "export async function saveOrder(order: Order) {",
    "  if (!order.id) throw new Error('missing id');",
    "  await repository.save(order);",
    "}",
    ...Array.from({ length: 80 }, (_, index) => `// unrelated generated note ${index}`)
  ].join("\n");
  const result = compressSourceCode(source, { query: "save order", tokenBudget: 140 });

  assert.match(result.content, /saveOrder/);
  assert.ok(estimateTokens(result.content) <= 140);
  assert.ok(estimateTokens(result.content) < estimateTokens(source));
});

test("context compression handles diff, diagnostics, documentation, and data projections", () => {
  const diff = ["diff --git a/a.ts b/a.ts", "@@ -1 +1 @@", ...Array.from({ length: 50 }, (_, index) => `+ const value${index} = ${index};`)].join("\n");
  const diagnostics = compressDiagnostics([
    { severity: "error", message: "Order validation failed", path: "src/orders.ts", line: 12 },
    { severity: "info", message: "Informational detail", path: "src/orders.ts", line: 1 }
  ], 80);
  const documentation = compressDocumentation("# Orders\n\n" + "Validation guidance. ".repeat(80), 40);
  const structured = compressStructuredData({ id: "order", nested: { token: "x".repeat(1000) }, values: Array.from({ length: 40 }, (_, index) => ({ id: index, status: "ok" })) }, 40);

  assert.match(compressDiff(diff, 40).content, /Added lines: 50/);
  assert.match(diagnostics.content, /Order validation failed/);
  assert.ok(estimateTokens(documentation.content) <= 40);
  assert.ok(estimateTokens(structured.content) <= 40);
});

test("validation output parser recognizes common framework summaries", () => {
  const pytest = parseValidationOutput("===== 7 passed, 2 skipped in 0.12s =====", "");
  assert.equal(pytest.testsPassed, 7);
  assert.equal(pytest.testsSkipped, 2);

  const vitest = parseValidationOutput("Test Suites: 2 passed, 2 total\nTests: 8 passed, 8 total", "");
  assert.equal(vitest.testSuitesPassed, 2);
  assert.equal(vitest.testsPassed, 8);
});

test("intent primary actions follow durable lifecycle state", () => {
  assert.equal(
    selectIntentPrimaryAction({ lifecycle: "DRAFT", goal: "Fix login", currentObjective: "", openQuestions: [], blockers: [] }).id,
    "understand"
  );
  assert.equal(
    selectIntentPrimaryAction({ lifecycle: "BLOCKED", goal: "", currentObjective: "", openQuestions: [], blockers: [{ summary: "Pick provider" }] }).id,
    "resolve-blocker"
  );
  assert.equal(
    selectIntentPrimaryAction({ lifecycle: "COMPLETE", goal: "", currentObjective: "", openQuestions: [], blockers: [] }).enabled,
    false
  );
  assert.equal(
    selectIntentPrimaryAction({ lifecycle: "UNDERSTANDING", goal: "Fix login", currentObjective: "", openQuestions: ["Which identity provider?"], blockers: [] }).operation,
    "ANSWER_QUESTION"
  );
  assert.equal(
    selectIntentPrimaryAction({ lifecycle: "REVIEW", goal: "", currentObjective: "", openQuestions: [], blockers: [] }).operation,
    "REVIEW_CHANGE"
  );
});

test("handoff encryption round-trips only with the correct passphrase", async () => {
  const encrypted = await encryptHandoffPackage("sensitive work state", "a sufficiently long passphrase");
  assert.equal(await decryptHandoffPackage(encrypted, "a sufficiently long passphrase"), "sensitive work state");
  await assert.rejects(() => decryptHandoffPackage(encrypted, "a different long passphrase"));
});

test("framework and messaging enrichment produces topology facts", () => {
  const source = "import express from 'express'; import kafka from 'kafka'; const auth = () => true; const router = express.Router(); router.use(auth); router.get('/orders', () => null); publish('orders.created'); subscribe('orders.created');";
  const analysis = analyzeArtifact("src/orders.ts", source);
  const detections = enrichEcosystem({ filePath: "src/orders.ts", language: "typescript", source, analysis });
  const facts = detections.flatMap((detection) => detection.facts);
  const relationships = detections.flatMap((detection) => detection.relationships);

  assert.ok(facts.some((fact) => fact.kind === "middleware" && fact.name === "auth"));
  assert.ok(facts.some((fact) => fact.kind === "message" && fact.name === "orders.created"));
  assert.ok(relationships.some((relationship) => relationship.kind === "publishes"));
  assert.ok(relationships.some((relationship) => relationship.kind === "subscribes"));
});

test("Prisma enrichment emits deterministic model query relationships", () => {
  const source = "import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient(); prisma.order.findMany(); prisma.order.update({ where: { id: 1 }, data: {} });";
  const analysis = analyzeArtifact("src/orders.ts", source);
  const detection = enrichEcosystem({ filePath: "src/orders.ts", language: "typescript", source, analysis })
    .find((item) => item.id === "prisma");
  const queries = detection?.facts.filter((fact) => fact.kind === "query") ?? [];

  assert.equal(queries.length, 2);
  assert.ok(queries.some((query) => query.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "order")));
  assert.ok(queries.some((query) => query.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "order")));
});

test("TypeORM enrichment links injected repository operations to their entity table", () => {
  const source = "import { Entity, Repository, InjectRepository } from 'typeorm'; @Entity() class Order {} class OrdersService { @InjectRepository(Order) private readonly orders: Repository<Order>; async load() { return this.orders.find(); } async save(order: Order) { return this.orders.save(order); } }";
  const analysis = analyzeArtifact("src/orders.ts", source);
  const detection = enrichEcosystem({ filePath: "src/orders.ts", language: "typescript", source, analysis })
    .find((item) => item.id === "typeorm");
  const facts = detection?.facts ?? [];

  assert.ok(facts.some((fact) => fact.kind === "repository" && fact.name === "OrderRepository"));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("Entity Framework enrichment links DbSet operations to their entity table", () => {
  const source = "using Microsoft.EntityFrameworkCore; class Order {} class OrdersContext : DbContext { public DbSet<Order> Orders { get; set; } void Load() { Orders.FirstOrDefault(); } void Save(Order order) { Orders.Add(order); } }";
  const analysis = analyzeArtifact("src/OrdersContext.cs", source);
  const detection = enrichEcosystem({ filePath: "src/OrdersContext.cs", language: "csharp", source, analysis })
    .find((item) => item.id === "entity-framework");
  const facts = detection?.facts ?? [];

  assert.ok(facts.some((fact) => fact.kind === "repository" && fact.name === "OrderDbSet"));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("SQLAlchemy enrichment links explicit model queries to their entity table", () => {
  const source = "from sqlalchemy import select, insert; from sqlalchemy.orm import Session; class Order: pass\ndef load(session: Session): return session.query(Order).first()\ndef list_all(session: Session): return select(Order)\ndef save(session: Session): session.add(Order())\ndef replace(session: Session): session.execute(insert(Order))";
  const analysis = analyzeArtifact("src/orders.py", source);
  const detection = enrichEcosystem({ filePath: "src/orders.py", language: "python", source, analysis })
    .find((item) => item.id === "sqlalchemy");
  const queries = detection?.facts.filter((fact) => fact.kind === "query") ?? [];

  assert.equal(queries.length, 4);
  assert.equal(
    queries.filter((query) => query.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")).length,
    2
  );
  assert.equal(
    queries.filter((query) => query.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")).length,
    2
  );
});

test("FastAPI and Flask decorators produce source-located route facts", () => {
  const fastApi = enrichEcosystem({ filePath: "src/api.py", language: "python", source: "from fastapi import FastAPI\napp = FastAPI()\n@app.post('/orders')\ndef create(): pass", analysis: analyzeArtifact("src/api.py", "") }).find((item) => item.id === "fastapi");
  const flask = enrichEcosystem({ filePath: "src/app.py", language: "python", source: "from flask import Flask\napp = Flask(__name__)\n@app.route('/health')\ndef health(): pass", analysis: analyzeArtifact("src/app.py", "") }).find((item) => item.id === "flask");
  assert.ok(fastApi?.facts.some((fact) => fact.kind === "route" && fact.name === "POST /orders" && fact.line === 3));
  assert.ok(flask?.facts.some((fact) => fact.kind === "route" && fact.name === "GET /health" && fact.line === 3));
  assert.ok(fastApi?.relationships.some((relationship) => relationship.kind === "handles" && relationship.sourceName === "POST /orders" && relationship.targetName === "create"));
  assert.ok(flask?.relationships.some((relationship) => relationship.kind === "handles" && relationship.sourceName === "GET /health" && relationship.targetName === "health"));
});

test("Spring mapping annotations produce exact route-to-handler facts", () => {
  const source = "import org.springframework.web.bind.annotation.GetMapping; class Orders { @GetMapping('/orders') public String list() { return \"ok\"; } }";
  const spring = enrichEcosystem({ filePath: "src/Orders.java", language: "java", source, analysis: analyzeArtifact("src/Orders.java", source) })
    .find((item) => item.id === "spring");
  assert.ok(spring?.facts.some((fact) => fact.kind === "route" && fact.name === "GET /orders"));
  assert.ok(spring?.facts.some((fact) => fact.kind === "handler" && fact.name === "list"));
  assert.ok(spring?.relationships.some((relationship) => relationship.kind === "handles" && relationship.sourceName === "GET /orders" && relationship.targetName === "list"));
});

test("ASP.NET minimal APIs produce exact route-to-handler facts", () => {
  const source = "using Microsoft.AspNetCore.Builder; var app = WebApplication.Create(); app.MapGet(\"/orders\", GetOrders);";
  const aspNet = enrichEcosystem({ filePath: "src/Program.cs", language: "csharp", source, analysis: analyzeArtifact("src/Program.cs", source) })
    .find((item) => item.id === "aspnet");
  assert.ok(aspNet?.facts.some((fact) => fact.kind === "route" && fact.name === "GET /orders"));
  assert.ok(aspNet?.relationships.some((relationship) => relationship.kind === "handles" && relationship.sourceName === "GET /orders" && relationship.targetName === "GetOrders"));
});

test("Ktor route blocks produce source-located route facts", () => {
  const source = "import io.ktor.server.routing.get\nfun routes() { get(\"/orders\") { } }";
  const ktor = enrichEcosystem({ filePath: "src/Routes.kt", language: "kotlin", source, analysis: analyzeArtifact("src/Routes.kt", source) })
    .find((item) => item.id === "ktor");
  assert.ok(ktor?.facts.some((fact) => fact.kind === "route" && fact.name === "GET /orders" && fact.line === 2));
});

test("Actix Web attributes produce exact route-to-handler facts", () => {
  const source = "use actix_web::get; #[get(\"/orders\")] async fn list() {}";
  const actix = enrichEcosystem({ filePath: "src/orders.rs", language: "rust", source, analysis: analyzeArtifact("src/orders.rs", source) })
    .find((item) => item.id === "actix-web");
  assert.ok(actix?.facts.some((fact) => fact.kind === "route" && fact.name === "GET /orders"));
  assert.ok(actix?.relationships.some((relationship) => relationship.kind === "handles" && relationship.sourceName === "GET /orders" && relationship.targetName === "list"));
});

test("SQLAlchemy model declarations preserve their explicit table identity", () => {
  const facts = detectEngineeringEntities(
    "src/models/order.py",
    "python",
    "from sqlalchemy.orm import declarative_base\nBase = declarative_base()\nclass Order(Base):\n    __tablename__ = 'sales_orders'"
  );
  assert.ok(facts.some((fact) => fact.kind === "orm-entity" && fact.name === "Order" && fact.properties.tableName === "sales_orders"));
  assert.ok(facts.some((fact) => fact.kind === "table" && fact.name === "sales_orders"));
});

test("Django ORM operations link deterministic reads and writes to their model", () => {
  const source = "from django.db import models\nclass Order(models.Model): pass\ndef load(): return Order.objects.filter(active=True)\ndef save(): return Order.objects.create(active=True)";
  const facts = enrichEcosystem({ filePath: "src/orders.py", language: "python", source, analysis: analyzeArtifact("src/orders.py", source) })
    .find((item) => item.id === "django-orm")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("Django model declarations preserve Meta.db_table identity", () => {
  const facts = detectEngineeringEntities(
    "src/models/order.py",
    "python",
    "from django.db import models\nclass Order(models.Model):\n    class Meta:\n        db_table = 'sales_orders'"
  );
  assert.ok(facts.some((fact) => fact.kind === "orm-entity" && fact.name === "Order" && fact.properties.tableName === "sales_orders"));
  assert.ok(facts.some((fact) => fact.kind === "table" && fact.name === "sales_orders"));
});

test("GORM operations link deterministic reads and writes to their model", () => {
  const source = "import \"gorm.io/gorm\"\ntype Order struct {}\nfunc load(db *gorm.DB) { var order Order; db.First(&order) }\nfunc save(db *gorm.DB) { db.Create(&Order{}) }";
  const facts = enrichEcosystem({ filePath: "src/orders.go", language: "go", source, analysis: analyzeArtifact("src/orders.go", source) })
    .find((item) => item.id === "gorm")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("Eloquent static operations link deterministic reads and writes to their model", () => {
  const source = "use Illuminate\\Database\\Eloquent\\Model; class Order extends Model {} $orders = Order::where('active', true)->get(); Order::create(['active' => true]);";
  const facts = enrichEcosystem({ filePath: "app/Order.php", language: "php", source, analysis: analyzeArtifact("app/Order.php", source) })
    .find((item) => item.id === "eloquent")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("Active Record operations link deterministic reads and writes to their model", () => {
  const source = "class Order < ApplicationRecord; end\nOrder.where(active: true)\nOrder.create!(active: true)";
  const facts = enrichEcosystem({ filePath: "app/models/order.rb", language: "ruby", source, analysis: analyzeArtifact("app/models/order.rb", source) })
    .find((item) => item.id === "active-record")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("Sequelize model operations link deterministic reads and writes", () => {
  const source = "import { Model, DataTypes } from 'sequelize'; class Order extends Model {} Order.findAll(); Order.create({ active: true });";
  const facts = enrichEcosystem({ filePath: "src/order.ts", language: "typescript", source, analysis: analyzeArtifact("src/order.ts", source) })
    .find((item) => item.id === "sequelize")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("Mongoose model operations link deterministic reads and writes", () => {
  const source = "import mongoose from 'mongoose'; const Order = mongoose.model('Order', new mongoose.Schema({})); Order.find({}); Order.create({ active: true });";
  const facts = enrichEcosystem({ filePath: "src/order.ts", language: "typescript", source, analysis: analyzeArtifact("src/order.ts", source) })
    .find((item) => item.id === "mongoose")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("Drizzle and Knex operations link deterministic reads and writes", () => {
  const drizzleSource = "import { drizzle } from 'drizzle-orm'; import { orders } from './schema'; const db = drizzle(client); db.select().from(orders); db.update(orders);";
  const drizzleFacts = enrichEcosystem({ filePath: "src/orders.ts", language: "typescript", source: drizzleSource, analysis: analyzeArtifact("src/orders.ts", drizzleSource) })
    .find((item) => item.id === "drizzle")?.facts ?? [];
  assert.ok(drizzleFacts.some((fact) => fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "orders")));
  assert.ok(drizzleFacts.some((fact) => fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "orders")));
  const knexSource = "import knex from 'knex'; knex('orders').select(); knex('orders').insert({ id: 1 });";
  const knexFacts = enrichEcosystem({ filePath: "src/orders.ts", language: "typescript", source: knexSource, analysis: analyzeArtifact("src/orders.ts", knexSource) })
    .find((item) => item.id === "knex")?.facts ?? [];
  assert.ok(knexFacts.some((fact) => fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "orders")));
  assert.ok(knexFacts.some((fact) => fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "orders")));
});

test("SQLx typed queries link deterministic reads to their target model", () => {
  const source = "use sqlx::FromRow; #[derive(FromRow)] struct Order { id: i32 } async fn load(pool: &sqlx::PgPool) { sqlx::query_as::<_, Order>(\"select * from orders\").fetch_all(pool).await.unwrap(); }";
  const facts = enrichEcosystem({ filePath: "src/orders.rs", language: "rust", source, analysis: analyzeArtifact("src/orders.rs", source) })
    .find((item) => item.id === "sqlx")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
});

test("EntityManager operations link deterministic reads and writes to their entity", () => {
  const source = "import jakarta.persistence.Entity; import jakarta.persistence.EntityManager; @Entity class Order {} class Orders { EntityManager entityManager; void load(){ entityManager.find(Order.class, 1); } void save(){ entityManager.persist(new Order()); } }";
  const facts = enrichEcosystem({ filePath: "src/Orders.java", language: "java", source, analysis: analyzeArtifact("src/Orders.java", source) })
    .find((item) => item.id === "hibernate")?.facts ?? [];
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "reads" && relation.targetName === "Order")));
  assert.ok(facts.some((fact) => fact.kind === "query" && fact.relations?.some((relation) => relation.kind === "writes" && relation.targetName === "Order")));
});

test("ORM query facts promote into cross-file OKF read and write relationships", () => {
  const source = "import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient(); prisma.order.findMany(); prisma.order.update({ where: { id: 1 }, data: {} });";
  const analysis = analyzeArtifact("src/orders.ts", source);
  const queryFacts = enrichEcosystem({ filePath: "src/orders.ts", language: "typescript", source, analysis })
    .find((item) => item.id === "prisma")?.facts ?? [];
  const tableFacts = detectEngineeringEntities("migrations/001-order.sql", "sql", "CREATE TABLE order(id INTEGER);");
  const snapshot = repoIntelligenceToOkf({
    workspaceRoot: "/repo",
    indexedAt: "2026-08-07T00:00:00.000Z",
    files: [
      { path: "src/orders.ts", language: "typescript", sizeBytes: source.length, lineCount: 1, isTest: false, isGenerated: false, summary: "orders" },
      { path: "migrations/001-order.sql", language: "sql", sizeBytes: 30, lineCount: 1, isTest: false, isGenerated: false, summary: "schema" }
    ],
    symbols: [], dependencies: [], tests: [], apis: [], services: [],
    engineeringEntities: [...queryFacts, ...tableFacts],
    ownershipHints: [], frameworkHints: [], securitySensitiveAreas: [], performanceSensitivePaths: [], modernizationCandidates: []
  }, { extractionRunId: "test-run", workspaceId: "test-workspace" });
  const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  const linked = snapshot.relationships.filter((relationship) => {
    const sourceUnit = units.get(relationship.sourceId);
    const targetUnit = units.get(relationship.targetId);
    return sourceUnit?.kind === "query" && targetUnit?.kind === "table" && targetUnit.name === "order";
  });

  assert.ok(linked.some((relationship) => relationship.kind === "reads"));
  assert.ok(linked.some((relationship) => relationship.kind === "writes"));
});

test("Django ORM query facts promote into canonical OKF read and write relationships", () => {
  const source = "from django.db import models\nclass Order(models.Model): pass\nOrder.objects.filter(active=True)\nOrder.objects.create(active=True)";
  const queryFacts = enrichEcosystem({ filePath: "src/orders.py", language: "python", source, analysis: analyzeArtifact("src/orders.py", source) })
    .find((item) => item.id === "django-orm")?.facts ?? [];
  const tableFacts = detectEngineeringEntities("migrations/001-order.sql", "sql", "CREATE TABLE order(id INTEGER);");
  const snapshot = repoIntelligenceToOkf({
    workspaceRoot: "/repo", indexedAt: "2026-08-07T00:00:00.000Z",
    files: [
      { path: "src/orders.py", language: "python", sizeBytes: source.length, lineCount: 4, isTest: false, isGenerated: false, summary: "orders" },
      { path: "migrations/001-order.sql", language: "sql", sizeBytes: 30, lineCount: 1, isTest: false, isGenerated: false, summary: "schema" }
    ],
    symbols: [], dependencies: [], tests: [], apis: [], services: [], engineeringEntities: [...queryFacts, ...tableFacts],
    ownershipHints: [], frameworkHints: [], securitySensitiveAreas: [], performanceSensitivePaths: [], modernizationCandidates: []
  }, { extractionRunId: "django-test-run", workspaceId: "test-workspace" });
  const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  const linked = snapshot.relationships.filter((relationship) =>
    units.get(relationship.sourceId)?.kind === "query" && units.get(relationship.targetId)?.kind === "table" && units.get(relationship.targetId)?.name === "order"
  );
  assert.ok(linked.some((relationship) => relationship.kind === "reads"));
  assert.ok(linked.some((relationship) => relationship.kind === "writes"));
});

test("migration paths create migration and persistence entities", () => {
  const facts = detectEngineeringEntities(
    "migrations/001-orders.sql",
    "sql",
    "CREATE TABLE orders(id INTEGER);"
  );

  assert.ok(facts.some((fact) => fact.kind === "migration" && fact.name === "001-orders"));
  assert.ok(facts.some((fact) => fact.kind === "database"));
  assert.ok(facts.some((fact) => fact.kind === "table" && fact.name === "orders"));
});

test("major framework detectors report their supported ecosystems", () => {
  const examples = [
    ["api.ts", "import fastify from 'fastify'; fastify.get('/health', () => null);", "typescript", "fastify"],
    ["app/page.tsx", "import next from 'next'; export async function generateStaticParams(){ return []; }", "typescript", "nextjs"],
    ["app.py", "from flask import Flask\napp = Flask(__name__)\n@app.route('/health')\ndef health(): return 'ok'", "python", "flask"],
    ["main.rs", "use actix_web::get; #[get(\"/health\")] async fn health() {}", "rust", "actix-web"],
    ["app.tsx", "import React, { useState } from 'react'; export const App = () => useState(0);", "typescript", "react"],
    ["app.ts", "import { createApp } from 'vue'; createApp({});", "typescript", "vue"],
    ["app.component.ts", "import { Component } from '@angular/core'; @Component({}) export class AppComponent {}", "typescript", "angular"],
    ["routes.rb", "Rails.application.routes.draw { resources :orders }", "ruby", "rails"],
    ["routes.php", "Route::get('/orders', 'OrderController@index');", "php", "laravel"],
    ["Orders.java", "import io.quarkus.runtime; @Path('/orders') class Orders {}", "java", "quarkus"],
    ["Orders.kt", "import io.ktor.server.routing.routing; fun app() { routing { get { } } }", "kotlin", "ktor"],
    ["router.ex", "use Phoenix.Router\nget \"/orders\", OrderController, :index", "elixir", "phoenix"],
    ["main.dart", "import 'package:flutter/material.dart'; class App extends StatelessWidget {}", "dart", "flutter"],
    ["App.tsx", "import { View, Text } from 'react-native'; export const App = () => <View><Text>Hi</Text></View>;", "typescript", "react-native"]
  ] as const;
  for (const [filePath, source, language, expected] of examples) {
    const detections = enrichEcosystem({ filePath, language, source, analysis: analyzeArtifact(filePath, source) });
    assert.ok(detections.some((detection) => detection.id === expected), `expected ${expected}`);
  }
});
