import { describe, expect, it } from "vitest";
import { TreeSitterExtractionAdapter } from "../../../src/core/intelligence/extraction/TreeSitterExtractionAdapter";
import type { TreeSitterIdProvider } from "../../../src/core/intelligence/extraction/TreeSitterExtractionAdapter";

/**
 * Polyglot conformance test for Phase A structural extraction.
 * Asserts: per-language symbol extraction, call-graph edges, imports, and
 * graceful skip for unsupported languages. The adapter is disabled by default
 * in production; this test enables it explicitly and resolves the WASM grammars.
 */

function testIdProvider(): TreeSitterIdProvider {
  let counter = 0;
  const mk = (prefix: string): string => `${prefix}#${counter++}`;
  return {
    repositoryId: "repo:test",
    fileId: "file:test",
    generation: 1,
    entity: (_language, name, discriminator) => Promise.resolve(mk(`ent:${name}:${discriminator}`)),
    relationship: (sourceId, targetId, type, discriminator) =>
      Promise.resolve(mk(`rel:${sourceId}->${targetId}:${type}:${discriminator}`)),
    evidence: (subjectId, _relativePath, line) => Promise.resolve(mk(`ev:${subjectId}:${line}`)),
  };
}

function enabledAdapter(): TreeSitterExtractionAdapter {
  const adapter = new TreeSitterExtractionAdapter();
  adapter.enabled = true;
  return adapter;
}

describe("TreeSitterExtractionAdapter (Phase A polyglot)", () => {
  it("extracts functions, classes, and call edges from Python", async () => {
    const adapter = enabledAdapter();
    const python = [
      "def helper():",
      "    return 1",
      "",
      "class Calculator:",
      "    def add(self, a, b):",
      "        return helper()",
      "",
      "def compute():",
      "    return helper()",
      "",
      "def run():",
      "    helper()",
      "    compute()",
    ].join("\n");

    const result = await adapter.extractSymbols("python", "calc.py", python, testIdProvider());
    expect(result.available).toBe(true);
    expect(result.extractorId).toBe("keystone.tree-sitter");
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("helper");
    expect(names).toContain("Calculator");
    expect(names).toContain("compute");
    expect(names).toContain("run");
    // Call edges from top-level functions: compute -> helper, run -> helper, run -> compute
    const calls = result.relationships.filter((r) => r.type === "keystone.core.CALLS");
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts Go functions, structs, methods, and imports", async () => {
    const adapter = enabledAdapter();
    const go = [
      'package main',
      "",
      'import "fmt"',
      "",
      "type Server struct {",
      "    Host string",
      "}",
      "",
      "func (s *Server) Start() {",
      "    fmt.Println(s.Host)",
      "}",
      "",
      "func main() {",
      "    s := &Server{}",
      "    s.Start()",
      "}",
    ].join("\n");

    const result = await adapter.extractSymbols("go", "main.go", go, testIdProvider());
    expect(result.available).toBe(true);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Server");
    expect(names).toContain("Start");
    expect(names).toContain("main");
    const imports = result.relationships.filter((r) => r.type === "keystone.core.IMPORTS");
    expect(imports.length).toBe(1);
    const calls = result.relationships.filter((r) => r.type === "keystone.core.CALLS");
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts Rust functions, structs, impl methods, and use declarations", async () => {
    const adapter = enabledAdapter();
    const rust = [
      "use std::collections::HashMap;",
      "",
      "struct Point {",
      "    x: i32,",
      "    y: i32,",
      "}",
      "",
      "impl Point {",
      "    fn new() -> Point {",
      "        Point { x: 0, y: 0 }",
      "    }",
      "}",
      "",
      "fn main() {",
      "    let p = Point::new();",
      "}",
    ].join("\n");

    const result = await adapter.extractSymbols("rust", "main.rs", rust, testIdProvider());
    expect(result.available).toBe(true);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Point");
    expect(names).toContain("new");
    expect(names).toContain("main");
    const imports = result.relationships.filter((r) => r.type === "keystone.core.IMPORTS");
    expect(imports.length).toBe(1);
  });

  it("extracts Java classes, methods, and imports (including constructors)", async () => {
    const adapter = enabledAdapter();
    const java = [
      "package com.example;",
      "",
      "import java.util.List;",
      "",
      "public class Service {",
      "    private int count;",
      "    public Service() {",
      "        this.count = 0;",
      "    }",
      "    public void run() {",
      "        helper();",
      "    }",
      "    private void helper() {",
      "    }",
      "}",
    ].join("\n");

    const result = await adapter.extractSymbols("java", "Service.java", java, testIdProvider());
    expect(result.available).toBe(true);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Service");
    expect(names).toContain("run");
    expect(names).toContain("helper");
    const imports = result.relationships.filter((r) => r.type === "keystone.core.IMPORTS");
    expect(imports.length).toBe(1);
  });

  it("extracts TypeScript functions, classes, arrow functions, and imports", async () => {
    const adapter = enabledAdapter();
    const ts = [
      'import { readFile } from "fs";',
      "",
      "export function load() {",
      "    return readFile();",
      "}",
      "",
      "export class Repository {",
      "    constructor(private name: string) {}",
      "    open() {",
      "        load();",
      "    }",
      "}",
      "",
      "const run = () => {",
      "    load();",
      "};",
    ].join("\n");

    const result = await adapter.extractSymbols("typescript", "repo.ts", ts, testIdProvider());
    expect(result.available).toBe(true);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("load");
    expect(names).toContain("Repository");
    expect(names).toContain("run");
    const imports = result.relationships.filter((r) => r.type === "keystone.core.IMPORTS");
    expect(imports.length).toBe(1);
  });

  it("gracefully skips unsupported languages when disabled or unavailable", async () => {
    const disabled = new TreeSitterExtractionAdapter();
    const skipped = await disabled.extractSymbols("ruby", "x.rb", "puts 1", testIdProvider());
    expect(skipped.available).toBe(false);
    expect(skipped.parseStatus).toBe("unsupported");
    expect(skipped.symbols).toHaveLength(0);
  });

  it("reports unsupported (not throws) for languages without a loaded grammar", async () => {
    const adapter = enabledAdapter();
    const result = await adapter.extractSymbols("cobol", "prog.cbl", "PROCEDURE DIVISION.", testIdProvider());
    expect(result.available).toBe(false);
    expect(result.parseStatus).toBe("unsupported");
    expect(result.symbols).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });
});
