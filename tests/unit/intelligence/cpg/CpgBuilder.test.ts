import { describe, expect, it } from "vitest";
import { CpgScopeArtifactSchema, type CpgScopeArtifact } from "../../../../src/shared/contracts/cpg";
import { ProgramSliceService } from "../../../../src/core/intelligence/cpg/ProgramSliceService";
import { TypeScriptJavaScriptParser } from "../../../../src/core/intelligence/semantic/TypeScriptJavaScriptParser";
import type { SemanticProjectRequest, SemanticSourceFileInput } from "../../../../src/core/intelligence/semantic/SemanticModel";

describe("progressive TypeScript CPG", () => {
  const coverageCases: Array<[string, (scopes: CpgScopeArtifact[]) => boolean]> = [
    ["basic function AST graph", (scopes) => kinds(find(scopes, "compute")).includes("FUNCTION")],
    ["method AST graph", (scopes) => kinds(find(scopes, "Box.read")).includes("METHOD")],
    ["arrow-function scope", (scopes) => scopes.some((scope) => scope.descriptor.kind === "arrow")],
    ["parameter definition", (scopes) => kinds(find(scopes, "flow")).includes("PARAMETER") && edgeTypes(find(scopes, "flow")).includes("DEFINES")],
    ["variable definition and use", (scopes) => edgeTypes(find(scopes, "flow")).includes("USES")],
    ["reassignment", (scopes) => kinds(find(scopes, "flow")).includes("ASSIGNMENT")],
    ["argument-to-parameter binding", (scopes) => edgeTypes(find(scopes, "compute")).includes("ARGUMENT_TO_PARAMETER")],
    ["return-value flow", (scopes) => edgeTypes(find(scopes, "compute")).includes("RETURN_TO_CALL")],
    ["nested calls", (scopes) => find(scopes, "compute").nodes.filter((node) => node.kind === "CALL").length >= 3],
    ["constructor calls", (scopes) => kinds(find(scopes, "make")).includes("CONSTRUCTOR_CALL")],
    ["awaited calls", (scopes) => kinds(find(scopes, "compute")).includes("AWAIT")],
    ["if/else control flow", (scopes) => edgeTypes(find(scopes, "control")).includes("CFG_TRUE") && edgeTypes(find(scopes, "control")).includes("CFG_FALSE")],
    ["switch control flow", (scopes) => edgeTypes(find(scopes, "control")).includes("CFG_CASE")],
    ["for loop", (scopes) => find(scopes, "control").nodes.filter((node) => node.kind === "LOOP").length >= 1],
    ["while loop", (scopes) => find(scopes, "control").nodes.filter((node) => node.kind === "LOOP").length >= 2],
    ["break flow", (scopes) => edgeTypes(find(scopes, "control")).includes("CFG_BREAK")],
    ["continue flow", (scopes) => edgeTypes(find(scopes, "control")).includes("CFG_CONTINUE")],
    ["try/catch/finally", (scopes) => ["TRY", "CATCH", "FINALLY"].every((kind) => kinds(find(scopes, "control")).includes(kind))],
    ["explicit throw", (scopes) => kinds(find(scopes, "control")).includes("THROW_STATEMENT") && edgeTypes(find(scopes, "control")).includes("CFG_EXCEPTION")],
    ["short-circuit boolean expression", (scopes) => find(scopes, "flow").nodes.some((node) => node.properties?.shortCircuit === true)],
    ["conditional expression", (scopes) => kinds(find(scopes, "compute")).includes("CONDITIONAL_EXPRESSION")],
    ["optional chaining", (scopes) => find(scopes, "compute").nodes.some((node) => node.properties?.optionalChain === true)],
    ["destructuring", (scopes) => find(scopes, "flow").nodes.some((node) => node.kind === "VARIABLE_DECLARATION" && node.code?.startsWith("{ value:"))],
    ["basic object-property flow", (scopes) => find(scopes, "flow").edges.some((edge) => edge.type === "FLOWS_TO" && edge.confidence === 0.7)],
    ["unresolved dynamic call", (scopes) => kinds(find(scopes, "compute")).includes("UNRESOLVED_TARGET")],
    ["external call representation", (scopes) => kinds(find(scopes, "compute")).includes("EXTERNAL_CALL")],
    ["exact local call binding", (scopes) => edgeTypes(find(scopes, "compute")).includes("CALLS_SYMBOL")],
    ["evaluation-order overlay", (scopes) => edgeTypes(find(scopes, "compute")).includes("EVAL_NEXT")],
    ["scope entry and exit", (scopes) => ["ENTRY", "EXIT"].every((kind) => kinds(find(scopes, "compute")).includes(kind))],
    ["structural scope return", (scopes) => kinds(find(scopes, "compute")).includes("RETURN")],
    ["receiver-to-call flow", (scopes) => edgeTypes(find(scopes, "compute")).includes("RECEIVER_TO_CALL")],
    ["CFG return termination", (scopes) => edgeTypes(find(scopes, "compute")).includes("CFG_RETURN")],
    ["evidence-backed nodes", (scopes) => find(scopes, "compute").nodes.every((node) => node.evidenceIds.length > 0)],
    ["evidence-backed edges", (scopes) => find(scopes, "compute").edges.every((edge) => edge.evidenceIds.length > 0)],
    ["stable edge IDs", (scopes) => new Set(find(scopes, "compute").edges.map((edge) => edge.id)).size === find(scopes, "compute").edges.length],
    ["module executable scope", (scopes) => scopes.some((scope) => scope.descriptor.kind === "module")],
    ["approximation diagnostic", (scopes) => find(scopes, "flow").diagnostics.some((item) => item.code === "approximate-data-flow")],
    ["exception-model diagnostic", (scopes) => find(scopes, "control").diagnostics.some((item) => item.code === "incomplete-exception-model")]
  ];
  const shared = build();
  it.each(coverageCases)("covers %s", async (_name, verify) => { expect(verify(await shared)).toBe(true); });

  it("builds normalized ASTs for functions, methods, arrows, parameters, calls, and returns", async () => {
    const scopes = await build();
    expect(scopes.length).toBeGreaterThanOrEqual(6);
    expect(scopes.map((scope) => scope.descriptor.kind)).toEqual(expect.arrayContaining(["function", "method", "constructor", "arrow"]));
    const compute = find(scopes, "compute");
    expect(kinds(compute)).toEqual(expect.arrayContaining(["FUNCTION", "PARAMETER", "BLOCK", "VARIABLE_DECLARATION", "CALL", "RETURN_STATEMENT"]));
    expect(edgeTypes(compute)).toEqual(expect.arrayContaining(["AST_CHILD", "AST_PARENT", "BELONGS_TO_SCOPE"]));
    expect(() => CpgScopeArtifactSchema.parse(compute)).not.toThrow();
    expect(compute.nodes.every((node) => node.evidenceIds.length > 0 && node.parserVersion && node.generation === 1)).toBe(true);
    expect(compute.edges.every((edge) => edge.evidenceIds.length > 0 && edge.sourceId !== edge.targetId)).toBe(true);
  });

  it("models deterministic evaluation order, nested and awaited calls, optional access, and conditional expressions", async () => {
    const compute = find(await build(), "compute");
    const evaluated = compute.nodes.filter((node) => node.evaluationIndex !== undefined).sort((left, right) => left.evaluationIndex! - right.evaluationIndex!);
    expect(evaluated.length).toBeGreaterThan(8);
    expect(edgeTypes(compute)).toEqual(expect.arrayContaining(["EVAL_NEXT", "EVAL_PREVIOUS"]));
    expect(kinds(compute)).toEqual(expect.arrayContaining(["AWAIT", "CONDITIONAL_EXPRESSION", "MEMBER_ACCESS", "CALL"]));
    expect(compute.nodes.some((node) => node.properties?.optionalChain === true)).toBe(true);
    expect(compute.nodes.some((node) => node.kind === "BINARY_EXPRESSION" && node.properties?.shortCircuit === true)).toBe(true);
  });

  it("computes parameter, variable, reassignment, property, reaching-definition, and return flow", async () => {
    const flow = find(await build(), "flow");
    expect(flow.descriptor.summary.parameters).toBe(1);
    expect(flow.descriptor.summary.localVariables).toBeGreaterThanOrEqual(2);
    expect(flow.descriptor.summary.reads).toBeGreaterThan(0);
    expect(flow.descriptor.summary.writes).toBeGreaterThan(0);
    expect(edgeTypes(flow)).toEqual(expect.arrayContaining(["DEFINES", "USES", "REACHING_DEFINITION", "FLOWS_TO"]));
    expect(flow.diagnostics.some((item) => item.code === "approximate-data-flow")).toBe(true);
  });

  it("builds branches, switch, for/while, break/continue, and try/catch/finally exception flow", async () => {
    const control = find(await build(), "control");
    expect(kinds(control)).toEqual(expect.arrayContaining(["IF", "SWITCH", "CASE", "LOOP", "BREAK", "CONTINUE", "TRY", "CATCH", "FINALLY", "THROW_STATEMENT"]));
    expect(edgeTypes(control)).toEqual(expect.arrayContaining(["CFG_NEXT", "CFG_TRUE", "CFG_FALSE", "CFG_CASE", "CFG_BREAK", "CFG_CONTINUE", "CFG_EXCEPTION", "CFG_RETURN"]));
    expect(control.diagnostics.some((item) => item.code === "incomplete-exception-model")).toBe(true);
  });

  it("binds exact local arguments, parameters, receivers, and returns without inventing dynamic targets", async () => {
    const scopes = await build();
    const compute = find(scopes, "compute");
    expect(edgeTypes(compute)).toEqual(expect.arrayContaining(["CALLS_SYMBOL", "ARGUMENT_TO_PARAMETER", "RETURN_TO_CALL", "RECEIVER_TO_CALL"]));
    expect(compute.nodes.some((node) => node.kind === "EXTERNAL_CALL")).toBe(true);
    expect(compute.nodes.some((node) => node.kind === "UNRESOLVED_TARGET")).toBe(true);
    expect(compute.diagnostics.some((item) => item.code === "unresolved-call" && item.message.includes("no local target was fabricated"))).toBe(true);
    const constructor = find(scopes, "make");
    expect(kinds(constructor)).toContain("CONSTRUCTOR_CALL");
    expect(edgeTypes(constructor)).toContain("INSTANTIATES_SYMBOL");
  });

  it("produces bounded backward and forward slices with truncation and unsupported boundaries", async () => {
    const flow = find(await build(), "flow");
    const read = flow.nodes.find((node) => node.properties?.read === true)!;
    const slicer = new ProgramSliceService();
    const backward = slicer.slice(flow, { semanticSymbolId: flow.descriptor.semanticSymbolId, nodeId: read.id, direction: "backward", includeConditions: true, maxNodes: 100, maxDepth: 8, maxPaths: 10, timeBudgetMs: 500 });
    expect(backward.direction).toBe("backward");
    expect(backward.nodes.length).toBeGreaterThan(0);
    expect(backward.fragments.every((item, index) => item.order === index)).toBe(true);
    const forward = slicer.slice(flow, { semanticSymbolId: flow.descriptor.semanticSymbolId, nodeId: flow.nodes.find((node) => node.kind === "PARAMETER")!.id, direction: "forward", includeConditions: true, maxNodes: 2, maxDepth: 8, maxPaths: 1, timeBudgetMs: 500 });
    expect(forward.direction).toBe("forward");
    expect(forward.nodes.length).toBeLessThanOrEqual(2);
    expect(forward.truncated).toBe(true);
  });

  it("keeps stable IDs, reuses unchanged scopes, replaces a changed scope, and removes a deleted scope", async () => {
    const parser = new TypeScriptJavaScriptParser(); const files = fixture();
    const first = await parser.extract(request(1, true, files));
    const repeated = await parser.extract(request(2, false, []));
    expect(repeated.cpg?.scopes.map((item) => item.descriptor.id)).toEqual(first.cpg?.scopes.map((item) => item.descriptor.id));
    expect(repeated.cpg?.scopes.every((item) => item.reused)).toBe(true);
    const input = files[0]!; const changed = { ...input, content: input.content.replace("return total + state.value;", "return total + state.value + 1;"), contentHash: "sha256:changed" };
    const updated = await parser.extract(request(3, false, [changed]));
    expect(updated.cpg?.scopes.find((item) => item.descriptor.name.endsWith("flow"))?.reused).toBe(false);
    expect(updated.cpg?.scopes.find((item) => item.descriptor.name.endsWith("control"))?.reused).toBe(true);
    const deleted = await parser.extract({ ...request(4, false, []), removedPaths: [input.relativePath] });
    expect(deleted.cpg?.scopes).toHaveLength(0);
    expect(deleted.cpg?.removedScopeIds.length).toBeGreaterThan(0);
  });
});

async function build(): Promise<CpgScopeArtifact[]> { const result = await new TypeScriptJavaScriptParser().extract(request(1, true, fixture())); return result.cpg?.scopes ?? []; }
function find(scopes: CpgScopeArtifact[], suffix: string): CpgScopeArtifact { const scope = scopes.find((item) => item.descriptor.name.endsWith(suffix)); if (!scope) throw new Error(`Missing ${suffix} scope: ${scopes.map((item) => item.descriptor.name).join(", ")}`); return scope; }
function kinds(scope: CpgScopeArtifact): string[] { return scope.nodes.map((node) => node.kind); }
function edgeTypes(scope: CpgScopeArtifact): string[] { return scope.edges.map((edge) => edge.type); }

function fixture(): SemanticSourceFileInput[] { return [file("src/cpg.ts", `
class Box { constructor(public value: number) {} read(): number { return this.value; } }
function double(value: number): number { return value * 2; }
export async function compute(input?: { value: number }): Promise<number> {
  const box = new Box(input?.value ?? 0);
  const transformed = await Promise.resolve(double(box.read()));
  (globalThis as any).dynamic(transformed);
  return transformed > 0 ? transformed : 0;
}
export function make(value: number): Box { return new Box(value); }
export function flow(input: number): number {
  let total = input;
  total = total + 1;
  const state = { value: total };
  state.value = total + 2;
  const { value: picked = total } = state;
  const allowed = picked > 0 && total > 0;
  if (allowed) total = picked;
  return total + state.value;
}
export function control(values: number[]): number {
  let result = 0;
  for (const value of values) { if (value < 0) continue; if (value > 10) break; result += value; }
  while (result < 2) result++;
  switch (result) { case 1: result += 1; break; default: result += 2; }
  try { if (result === 4) throw new Error("four"); } catch (error) { result = 5; } finally { result += 1; }
  return result;
}
export const arrow = (value: number): number => value + 1;
`)] }
function file(relativePath: string, content: string): SemanticSourceFileInput { return { uri: `file:///fixture/${relativePath}`, relativePath, workspaceRootId: "root:fixture", fileId: `file:${relativePath}`, language: "typescript", category: "source", contentHash: `sha256:${relativePath}`, content }; }
function request(generation: number, reset: boolean, changedFiles: SemanticSourceFileInput[]): SemanticProjectRequest { return { repositoryId: "repository:cpg", projectKey: "cpg", generation, jobRevision: generation, reset, branch: "main", commit: "abc", changedFiles, removedPaths: [] }; }
