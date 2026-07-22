import { describe, expect, it } from "vitest";
import { SchemaSurfaceExtractor } from "../../../src/core/intelligence/schema/SchemaSurfaceExtractor";
import {
  detectMigrationFramework,
  detectOrmFramework,
  looksLikeRouteSurface,
  looksLikeSqlDdl,
} from "../../../src/core/intelligence/schema/SchemaRules";

interface ProviderState {
  entities: { id: string; kind: string; name: string }[];
  relationships: { id: string; sourceId: string; targetId: string; type: string }[];
}
function testProvider(): ReturnType<SchemaSurfaceExtractor["extract"]> extends Promise<infer _R>
  ? import("../../../src/core/intelligence/schema/SchemaSurfaceExtractor").SchemaSurfaceIdProvider
  : never {
  const state: ProviderState = { entities: [], relationships: [] };
  return {
    repositoryId: "repo:test",
    fileId: "file:test",
    generation: 1,
    entity: (kind: string, name: string, discriminator: string) => {
      const id = `ent:${kind}:${name}:${discriminator}`;
      state.entities.push({ id, kind, name });
      return Promise.resolve(id);
    },
    relationship: (sourceId: string, targetId: string, type: string, discriminator: string) => {
      const id = `rel:${sourceId}:${targetId}:${type}:${discriminator}`;
      state.relationships.push({ id, sourceId, targetId, type });
      return Promise.resolve(id);
    },
  };
}

const SQL_DDL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  org_id INTEGER
);
CREATE TABLE orgs (
  id INTEGER PRIMARY KEY,
  name VARCHAR(100)
);
ALTER TABLE users ADD CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES orgs;
`;

const SQLALCHEMY = `
from sqlalchemy import Column, Integer, String
from sqlalchemy.ext.declarative import declarative_base
Base = declarative_base()
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String)
`;

const PRISMA = `
model User {
  id    Int    @id @default(autoincrement())
  email String
  posts Post[]
}
model Post {
  id     Int  @id
  author User @relation(fields: [authorId], references: [id])
}
`;

const ROUTES_PY = `
from fastapi import FastAPI
app = FastAPI()
@app.get("/users")
def list_users():
    return db.query(User)
@app.post("/orgs")
def create_org():
    return
`;

const MIGRATION = `
def upgrade():
    op.create_table("users", sa.Column("id", sa.Integer()))
def downgrade():
    op.drop_table("users")
`;

describe("Phase C — SchemaRules", () => {
  it("detects SQL DDL by content", () => {
    expect(looksLikeSqlDdl("schema.sql", "sql", "CREATE TABLE x (id INT);")).toBe(true);
    expect(looksLikeSqlDdl("x.py", "python", "def f(): pass")).toBe(false);
  });
  it("detects ORM framework from content", () => {
    expect(detectOrmFramework("python", SQLALCHEMY)).toBe("sqlalchemy");
    expect(detectOrmFramework("typescript", PRISMA)).toBe("prisma");
  });
  it("detects migration frameworks from path", () => {
    expect(detectMigrationFramework("migrations/versions/001_init.py", "")).toEqual({ framework: "alembic", confidence: 1 });
    expect(detectMigrationFramework("db/migrate/20240101000000_create_users.rb", "")).toEqual({ framework: "rails-migrations", confidence: 1 });
    expect(detectMigrationFramework("prisma/migrations/20240101_init/migration.sql", "")).toEqual({ framework: "prisma-migrate", confidence: 1 });
  });
  it("detects route surfaces", () => {
    expect(looksLikeRouteSurface("python", ROUTES_PY)).toBe(true);
    expect(looksLikeRouteSurface("python", "def f(): pass")).toBe(false);
  });
});

describe("Phase C — SchemaSurfaceExtractor", () => {
  it("parses SQL DDL into tables, columns, and a foreign-key edge", async () => {
    const svc = new SchemaSurfaceExtractor();
    svc.enabled = true;
    const result = await svc.extract("schema.sql", "sql", SQL_DDL, testProvider());
    const tables = result.symbols.filter((s) => s.kind === "table").map((s) => s.name).sort();
    const columns = result.symbols.filter((s) => s.kind === "column").map((s) => s.name);
    const fks = result.relationships.filter((r) => r.type === "keystone.core.FOREIGN_KEY");
    expect(tables).toEqual(["orgs", "users"]);
    expect(columns).toContain("email");
    expect(columns).toContain("org_id");
    expect(fks.length).toBe(1);
    expect(fks[0]!.targetId).toContain("orgs");
    expect(result.available).toBe(true);
  });

  it("parses SQLAlchemy ORM models into entities + fields", async () => {
    const svc = new SchemaSurfaceExtractor();
    svc.enabled = true;
    const result = await svc.extract("models.py", "python", SQLALCHEMY, testProvider());
    const entities = result.symbols.filter((s) => s.kind === "orm-entity");
    const fields = result.symbols.filter((s) => s.kind === "orm-field");
    expect(entities.map((e) => e.name)).toContain("User");
    expect(fields.map((f) => f.name)).toContain("email");
    expect(result.relationships.some((r) => r.type === "keystone.core.ORM_HAS_FIELD")).toBe(true);
  });

  it("parses a migration file and emits a Migration symbol", async () => {
    const svc = new SchemaSurfaceExtractor();
    svc.enabled = true;
    const result = await svc.extract("migrations/versions/001_init.py", "python", MIGRATION, testProvider());
    const migrations = result.symbols.filter((s) => s.kind === "migration");
    expect(migrations.length).toBe(1);
    expect(migrations[0]!.properties?.framework).toBe("alembic");
  });

  it("parses route surfaces and emits ROUTE_EXPOSES edges to referenced tables", async () => {
    const svc = new SchemaSurfaceExtractor();
    svc.enabled = true;
    // Provide a SQL file first so the referenced table id exists in the same run is not required;
    // ROUTE_EXPOSES references tbl ids; here we just assert route symbols + edges are produced.
    const result = await svc.extract("routes.py", "python", ROUTES_PY, testProvider());
    const routes = result.symbols.filter((s) => s.kind === "route");
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.some((r) => r.name.includes("GET /users"))).toBe(true);
    expect(result.relationships.some((r) => r.type === "keystone.core.ROUTE_EXPOSES")).toBe(true);
  });

  it("is inert when disabled", async () => {
    const svc = new SchemaSurfaceExtractor();
    const result = await svc.extract("schema.sql", "sql", SQL_DDL, testProvider());
    expect(result.available).toBe(false);
    expect(result.symbols.length).toBe(0);
  });

  it("emits a snapshot-clean surface: every relationship endpoint resolves to a real symbol id", async () => {
    const svc = new SchemaSurfaceExtractor();
    svc.enabled = true;
    const result = await svc.extract("schema.sql", "sql", SQL_DDL, testProvider());
    const symbolIds = new Set(result.symbols.map((s) => s.id));
    for (const rel of result.relationships) {
      expect(symbolIds.has(rel.sourceId)).toBe(true);
      expect(symbolIds.has(rel.targetId)).toBe(true);
    }
  });
});
