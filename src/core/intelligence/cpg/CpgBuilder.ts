import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  CpgDiagnostic,
  CpgEdge,
  CpgEdgeType,
  CpgNode,
  CpgNodeKind,
  CpgScopeArtifact,
  CpgScopeDescriptor,
} from "../../../shared/contracts/cpg";
import { CPG_PROVIDER_ID, CPG_SCHEMA_VERSION } from "../../../shared/contracts/cpg";
import type {
  IntelligenceEvidenceRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
  SourceRange,
} from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import {
  CpgEdgeFactory,
  CpgNodeFactory,
  cpgStableId,
  compactCode,
  containsRange,
} from "./CpgFactories";

export interface CpgBuildContext {
  repositoryId: string;
  generation: number;
  providerVersion: string;
  program: ts.Program;
  input: SemanticSourceFileInput;
  source: ts.SourceFile;
  entities: IntelligenceSymbolRecord[];
  entityIndex: ReadonlyMap<string, string>;
  relationships: IntelligenceRelationshipRecord[];
  evidence: IntelligenceEvidenceRecord[];
  analysisLevel: "basic" | "enriched";
}

interface ScopeCandidate {
  node: ts.Node;
  body: ts.ConciseBody | ts.Block | ts.SourceFile;
  kind: CpgScopeDescriptor["kind"];
  name: string;
  semantic: IntelligenceSymbolRecord;
}

export class CpgBuilder {
  private readonly nodes = new CpgNodeFactory();
  private readonly edges = new CpgEdgeFactory();

  buildFile(
    context: CpgBuildContext,
    reusable: ReadonlyMap<string, CpgScopeArtifact> = new Map(),
    bindCalls = true,
  ): CpgScopeArtifact[] {
    const scopes = discoverScopes(context);
    const artifacts = scopes.map((scope) => {
      const identity =
        scope.kind === "callback"
          ? `${scope.name}:${rangeOf(scope.node, context.source).startLine}:${rangeOf(scope.node, context.source).startColumn}`
          : scope.name;
      const scopeId = cpgStableId(
        "cpg-scope",
        context.repositoryId,
        context.input.fileId,
        scope.semantic.id,
        scope.kind,
        identity,
      );
      const structuralHash = `sha256:${createHash("sha256").update(structuralText(scope.node, context.source)).digest("hex")}`;
      const cached = reusable.get(scopeId);
      if (
        cached?.descriptor.structuralHash === structuralHash &&
        cached.descriptor.providerVersion === context.providerVersion &&
        cached.descriptor.analysisLevel === context.analysisLevel
      )
        return regenerate(cached, context.generation, context.input.contentHash);
      return this.buildScope(context, scope, scopeId, structuralHash);
    });
    if (bindCalls) new CallBindingAnalyzer(this.nodes, this.edges).bind(artifacts, context);
    return artifacts;
  }

  bindProject(artifacts: CpgScopeArtifact[], contexts: CpgBuildContext[]): void {
    new CallBindingAnalyzer(this.nodes, this.edges).bindProject(artifacts, contexts);
  }

  private buildScope(
    context: CpgBuildContext,
    candidate: ScopeCandidate,
    scopeId: string,
    structuralHash: string,
  ): CpgScopeArtifact {
    const range = rangeOf(candidate.node, context.source);
    const state = new ScopeState(context, candidate, scopeId, this.nodes, this.edges);
    new AstOverlayBuilder().build(state);
    new EvaluationOrderBuilder().build(state);
    new ControlFlowBuilder().build(state);
    new DefUseAnalyzer().analyze(state);
    const summary = state.summary();
    const descriptor: CpgScopeDescriptor = {
      id: scopeId,
      fileId: context.input.fileId,
      semanticSymbolId: candidate.semantic.id,
      name: candidate.name,
      kind: candidate.kind,
      range,
      sourceHash: context.input.contentHash,
      structuralHash,
      providerId: CPG_PROVIDER_ID,
      providerVersion: context.providerVersion,
      schemaVersion: CPG_SCHEMA_VERSION,
      analysisLevel: context.analysisLevel,
      generation: context.generation,
      nodeCount: state.nodeList.length,
      edgeCount: state.edgeList.length,
      summary,
      shard: `cpg/scopes/${safeKey(scopeId)}.json.gz`,
    };
    return {
      descriptor,
      entryNodeId: state.entry.id,
      exitNodeId: state.exit.id,
      nodes: state.nodeList,
      edges: state.edgeList,
      diagnostics: state.diagnostics,
      reused: false,
    };
  }
}

class ScopeState {
  readonly nodeByAst = new Map<ts.Node, CpgNode>();
  readonly astByNode = new Map<string, ts.Node>();
  readonly nodeList: CpgNode[] = [];
  readonly edgeList: CpgEdge[] = [];
  readonly diagnostics: CpgDiagnostic[] = [];
  readonly evidenceIds: string[];
  readonly entry: CpgNode;
  readonly exit: CpgNode;
  readonly scopeReturn: CpgNode;

  constructor(
    readonly context: CpgBuildContext,
    readonly candidate: ScopeCandidate,
    readonly scopeId: string,
    private readonly nodeFactory: CpgNodeFactory,
    private readonly edgeFactory: CpgEdgeFactory,
  ) {
    this.evidenceIds = candidate.semantic.evidenceIds;
    this.entry = this.addSynthetic("ENTRY", "entry");
    this.exit = this.addSynthetic("EXIT", "exit");
    this.scopeReturn = this.addSynthetic("RETURN", "return", "scope return");
    this.addEdge("FLOWS_TO", this.scopeReturn.id, this.exit.id, "calculated");
  }

  addAst(node: ts.Node, identity: string): CpgNode {
    const existing = this.nodeByAst.get(node);
    if (existing) return existing;
    const kind = normalizedKind(node);
    const range = rangeOf(node, this.context.source);
    const referenced = referencedSemanticEntity(
      node,
      this.context.program.getTypeChecker(),
      this.context.source,
      this.context.entityIndex,
    );
    const properties = nodeProperties(node, this.context.source);
    const created = this.nodeFactory.create({
      identity,
      fileId: this.context.input.fileId,
      scopeId: this.scopeId,
      semanticSymbolId: this.candidate.semantic.id,
      ...(referenced ? { referencedSemanticEntityId: referenced } : {}),
      kind,
      code: compactCode(sanitizedCode(node, this.context.source)),
      range,
      ...(properties.typeName ? { typeName: properties.typeName } : {}),
      evidenceIds: this.evidenceIds,
      parserVersion: this.context.providerVersion,
      generation: this.context.generation,
      ...(Object.keys(properties.values).length ? { properties: properties.values } : {}),
    });
    this.nodeByAst.set(node, created);
    this.astByNode.set(created.id, node);
    this.nodeList.push(created);
    return created;
  }

  addSynthetic(
    kind: CpgNodeKind,
    identity: string,
    code?: string,
    properties?: CpgNode["properties"],
  ): CpgNode {
    const node = this.nodeFactory.create({
      identity,
      fileId: this.context.input.fileId,
      scopeId: this.scopeId,
      semanticSymbolId: this.candidate.semantic.id,
      kind,
      ...(code ? { code } : {}),
      evidenceIds: this.evidenceIds,
      parserVersion: this.context.providerVersion,
      generation: this.context.generation,
      ...(properties ? { properties } : {}),
    });
    this.nodeList.push(node);
    return node;
  }

  addEdge(
    type: CpgEdgeType,
    sourceId: string,
    targetId: string,
    derivation: CpgEdge["derivation"] = "calculated",
    confidence = 1,
    properties?: CpgEdge["properties"],
  ): void {
    if (sourceId === targetId && type !== "CFG_NEXT") return;
    const edge = this.edgeFactory.create({
      sourceId,
      targetId,
      type,
      derivation,
      confidence,
      evidenceIds: this.evidenceIds,
      fileId: this.context.input.fileId,
      scopeId: this.scopeId,
      generation: this.context.generation,
      ...(properties ? { properties } : {}),
    });
    if (!this.edgeList.some((item) => item.id === edge.id)) this.edgeList.push(edge);
  }

  diagnostic(
    code: CpgDiagnostic["code"],
    message: string,
    node?: CpgNode,
    confidence?: number,
  ): void {
    this.diagnostics.push({
      id: cpgStableId("cpg-diagnostic", this.scopeId, code, node?.id, message),
      code,
      severity: code === "unreachable-code" ? "warning" : "info",
      message,
      fileId: this.context.input.fileId,
      scopeId: this.scopeId,
      ...(node?.range ? { range: node.range } : {}),
      ...(node ? { nodeId: node.id } : {}),
      ...(confidence === undefined ? {} : { confidence }),
    });
  }

  summary() {
    const count = (kind: CpgNodeKind): number =>
      this.nodeList.filter((node) => node.kind === kind).length;
    const propertyCount = (key: string): number =>
      this.nodeList.filter((node) => node.properties?.[key] === true).length;
    return {
      parameters: count("PARAMETER"),
      returns: count("RETURN_STATEMENT"),
      calls: count("CALL") + count("CONSTRUCTOR_CALL"),
      branches:
        count("IF") +
        count("CASE") +
        count("CONDITIONAL_EXPRESSION") +
        this.nodeList.filter(
          (node) => node.kind === "BINARY_EXPRESSION" && node.properties?.shortCircuit === true,
        ).length,
      reads: propertyCount("read"),
      writes: propertyCount("write"),
      localVariables: count("VARIABLE_DECLARATION"),
      unresolvedCalls: count("UNRESOLVED_TARGET"),
      approximateFlows: this.edgeList.filter(
        (edge) => edge.type === "FLOWS_TO" && edge.confidence < 1,
      ).length,
    };
  }
}

export class AstOverlayBuilder {
  build(state: ScopeState): void {
    const root = state.addAst(state.candidate.node, "root");
    state.addEdge("BELONGS_TO_SCOPE", root.id, state.entry.id, "extracted");
    const visit = (node: ts.Node, path: string): void => {
      if (node !== state.candidate.node && isNestedExecutable(node)) return;
      const parent = state.addAst(node, path);
      let childIndex = 0;
      node.forEachChild((child) => {
        if (child !== state.candidate.node && isNestedExecutable(child)) return;
        const childPath = `${path}.${childIndex++}`;
        const childNode = state.addAst(child, childPath);
        state.addEdge("AST_CHILD", parent.id, childNode.id, "extracted");
        state.addEdge("AST_PARENT", childNode.id, parent.id, "extracted");
        visit(child, childPath);
      });
    };
    visit(state.candidate.node, "root");
  }
}

export class EvaluationOrderBuilder {
  build(state: ScopeState): void {
    const ordered: CpgNode[] = [];
    const visit = (node: ts.Node): void => {
      if (node !== state.candidate.node && isNestedExecutable(node)) return;
      node.forEachChild(visit);
      const cpg = state.nodeByAst.get(node);
      if (cpg && isEvaluated(node)) ordered.push(cpg);
    };
    visit(state.candidate.body);
    ordered.forEach((node, index) => {
      node.evaluationIndex = index;
      if (index > 0) {
        state.addEdge("EVAL_NEXT", ordered[index - 1]!.id, node.id);
        state.addEdge("EVAL_PREVIOUS", node.id, ordered[index - 1]!.id);
      }
    });
  }
}

export class ControlFlowBuilder {
  build(state: ScopeState): void {
    const statements = topStatements(state.candidate.body, state.candidate.kind);
    if (statements.length === 0) {
      state.addEdge("CFG_NEXT", state.entry.id, state.exit.id);
      return;
    }
    const first = state.nodeByAst.get(statements[0]!);
    if (first) state.addEdge("CFG_NEXT", state.entry.id, first.id);
    this.sequence(state, statements, state.exit.id, undefined);
    this.expressionBranches(state);
    state.diagnostic(
      "incomplete-exception-model",
      "Only explicit throw statements participate in exception flow.",
      undefined,
      1,
    );
  }

  private expressionBranches(state: ScopeState): void {
    for (const [ast, node] of state.nodeByAst) {
      if (ts.isConditionalExpression(ast)) {
        const condition = state.nodeByAst.get(ast.condition);
        const whenTrue = state.nodeByAst.get(ast.whenTrue);
        const whenFalse = state.nodeByAst.get(ast.whenFalse);
        if (condition && whenTrue && whenFalse) {
          state.addEdge("CFG_TRUE", condition.id, whenTrue.id);
          state.addEdge("CFG_FALSE", condition.id, whenFalse.id);
          state.addEdge("CFG_NEXT", whenTrue.id, node.id);
          state.addEdge("CFG_NEXT", whenFalse.id, node.id);
        }
      }
      if (
        ts.isBinaryExpression(ast) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(ast.operatorToken.kind)
      ) {
        const left = state.nodeByAst.get(ast.left);
        const right = state.nodeByAst.get(ast.right);
        if (!left || !right) continue;
        const continuesOnTrue = ast.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
        state.addEdge(
          continuesOnTrue ? "CFG_TRUE" : "CFG_FALSE",
          left.id,
          right.id,
          "calculated",
          ast.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? 0.9 : 1,
          { operator: ast.operatorToken.getText() },
        );
        state.addEdge(
          continuesOnTrue ? "CFG_FALSE" : "CFG_TRUE",
          left.id,
          node.id,
          "calculated",
          ast.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? 0.9 : 1,
          { operator: ast.operatorToken.getText() },
        );
        state.addEdge("CFG_NEXT", right.id, node.id);
        if (ast.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
          state.diagnostic(
            "unsupported-syntax",
            "Nullish-coalescing control edges use conservative present/missing branch labels.",
            node,
            0.9,
          );
      }
    }
  }

  private sequence(
    state: ScopeState,
    statements: readonly ts.Statement[],
    fallthrough: string,
    loop?: { head: string; exit: string },
    exceptionTarget?: string,
  ): void {
    for (let index = 0; index < statements.length; index++) {
      const statement = statements[index]!;
      const node = state.nodeByAst.get(statement);
      if (!node) continue;
      const next =
        statements
          .slice(index + 1)
          .map((item) => state.nodeByAst.get(item))
          .find(Boolean)?.id ?? fallthrough;
      if (ts.isReturnStatement(statement)) {
        state.addEdge("CFG_RETURN", node.id, state.exit.id);
        this.markUnreachable(state, statements.slice(index + 1));
        break;
      }
      if (ts.isThrowStatement(statement)) {
        state.addEdge("CFG_EXCEPTION", node.id, exceptionTarget ?? state.exit.id);
        this.markUnreachable(state, statements.slice(index + 1));
        break;
      }
      if (ts.isBreakStatement(statement)) {
        state.addEdge("CFG_BREAK", node.id, loop?.exit ?? fallthrough);
        break;
      }
      if (ts.isContinueStatement(statement)) {
        state.addEdge("CFG_CONTINUE", node.id, loop?.head ?? fallthrough);
        break;
      }
      if (ts.isIfStatement(statement)) {
        this.ifStatement(state, statement, node, next, loop, exceptionTarget);
        continue;
      }
      if (isLoop(statement)) {
        this.loop(state, statement, node, next, exceptionTarget);
        continue;
      }
      if (ts.isSwitchStatement(statement)) {
        this.switchStatement(state, statement, node, next, loop, exceptionTarget);
        continue;
      }
      if (ts.isTryStatement(statement)) {
        this.tryStatement(state, statement, node, next, loop);
        continue;
      }
      state.addEdge("CFG_NEXT", node.id, next);
    }
  }

  private ifStatement(
    state: ScopeState,
    statement: ts.IfStatement,
    node: CpgNode,
    next: string,
    loop?: { head: string; exit: string },
    exceptionTarget?: string,
  ): void {
    const thenStatements = statementList(statement.thenStatement);
    const elseStatements = statement.elseStatement ? statementList(statement.elseStatement) : [];
    const thenEntry =
      thenStatements.map((item) => state.nodeByAst.get(item)).find(Boolean)?.id ?? next;
    const elseEntry =
      elseStatements.map((item) => state.nodeByAst.get(item)).find(Boolean)?.id ?? next;
    state.addEdge("CFG_TRUE", node.id, thenEntry);
    state.addEdge("CFG_FALSE", node.id, elseEntry);
    this.sequence(state, thenStatements, next, loop, exceptionTarget);
    if (elseStatements.length) this.sequence(state, elseStatements, next, loop, exceptionTarget);
  }

  private loop(
    state: ScopeState,
    statement: ts.IterationStatement,
    node: CpgNode,
    next: string,
    exceptionTarget?: string,
  ): void {
    const body = statementList(statement.statement);
    const entry = body.map((item) => state.nodeByAst.get(item)).find(Boolean)?.id ?? node.id;
    state.addEdge("CFG_TRUE", node.id, entry);
    state.addEdge("CFG_FALSE", node.id, next);
    this.sequence(state, body, node.id, { head: node.id, exit: next }, exceptionTarget);
  }

  private switchStatement(
    state: ScopeState,
    statement: ts.SwitchStatement,
    node: CpgNode,
    next: string,
    loop?: { head: string; exit: string },
    exceptionTarget?: string,
  ): void {
    for (const clause of statement.caseBlock.clauses) {
      const clauseNode = state.nodeByAst.get(clause);
      if (!clauseNode) continue;
      state.addEdge("CFG_CASE", node.id, clauseNode.id, "calculated", 1, {
        default: ts.isDefaultClause(clause),
      });
      const bodyEntry =
        clause.statements.map((item) => state.nodeByAst.get(item)).find(Boolean)?.id ?? next;
      state.addEdge("CFG_NEXT", clauseNode.id, bodyEntry);
      this.sequence(state, clause.statements, next, loop, exceptionTarget);
    }
  }

  private tryStatement(
    state: ScopeState,
    statement: ts.TryStatement,
    node: CpgNode,
    next: string,
    loop?: { head: string; exit: string },
  ): void {
    const finallyEntry = statement.finallyBlock?.statements
      .map((item) => state.nodeByAst.get(item))
      .find(Boolean)?.id;
    const catchNode = statement.catchClause
      ? state.nodeByAst.get(statement.catchClause)
      : undefined;
    const tryEntry =
      statement.tryBlock.statements.map((item) => state.nodeByAst.get(item)).find(Boolean)?.id ??
      finallyEntry ??
      next;
    state.addEdge("CFG_NEXT", node.id, tryEntry);
    if (catchNode) state.addEdge("CFG_EXCEPTION", node.id, catchNode.id);
    this.sequence(
      state,
      statement.tryBlock.statements,
      finallyEntry ?? next,
      loop,
      catchNode?.id ?? finallyEntry ?? state.exit.id,
    );
    if (statement.catchClause && catchNode) {
      const catchEntry =
        statement.catchClause.block.statements
          .map((item) => state.nodeByAst.get(item))
          .find(Boolean)?.id ??
        finallyEntry ??
        next;
      state.addEdge("CFG_NEXT", catchNode.id, catchEntry);
      this.sequence(
        state,
        statement.catchClause.block.statements,
        finallyEntry ?? next,
        loop,
        finallyEntry ?? state.exit.id,
      );
    }
    if (statement.finallyBlock && finallyEntry)
      this.sequence(state, statement.finallyBlock.statements, next, loop, state.exit.id);
  }

  private markUnreachable(state: ScopeState, statements: readonly ts.Statement[]): void {
    for (const statement of statements) {
      const node = state.nodeByAst.get(statement);
      if (node)
        state.diagnostic(
          "unreachable-code",
          "This statement is unreachable after an unconditional terminator.",
          node,
          1,
        );
    }
  }
}

export class DataFlowBuilder {
  build(state: ScopeState): void {
    new DefUseAnalyzer().analyze(state);
  }
}

export class DefUseAnalyzer {
  analyze(state: ScopeState): void {
    const definitions = new Map<string, CpgNode>();
    const nodes = [...state.nodeList].sort(
      (left, right) => (left.evaluationIndex ?? -1) - (right.evaluationIndex ?? -1),
    );
    const parameters =
      state.candidate.node && ts.isFunctionLike(state.candidate.node)
        ? state.candidate.node.parameters
        : [];
    for (const parameter of parameters) {
      const parameterNode = state.nodeByAst.get(parameter);
      const name = bindingName(parameter.name);
      if (parameterNode && name) {
        parameterNode.properties = { ...parameterNode.properties, variable: name, write: true };
        definitions.set(name, parameterNode);
        const identifier = state.nodeByAst.get(parameter.name);
        if (identifier) state.addEdge("DEFINES", parameterNode.id, identifier.id, "extracted");
      }
    }
    for (const node of nodes) {
      const ast = state.astByNode.get(node.id);
      if (!ast) continue;
      const nodeDefinitions = definitionsFor(ast);
      for (const definition of nodeDefinitions) {
        node.properties = { ...node.properties, variable: definition.name, write: true };
        const prior = definitions.get(definition.name);
        if (prior)
          state.addEdge(
            "FLOWS_TO",
            prior.id,
            node.id,
            "calculated",
            definition.approximate ? 0.7 : 1,
          );
        definitions.set(definition.name, node);
        if (definition.approximate)
          state.diagnostic(
            "approximate-data-flow",
            `Property flow for ${definition.name} uses a conservative access path.`,
            node,
            0.7,
          );
      }
      if (ts.isIdentifier(ast) && isReadIdentifier(ast)) {
        const name = accessPath(ast);
        node.properties = { ...node.properties, variable: name, read: true };
        const source = definitions.get(name) ?? definitions.get(ast.text);
        if (source) {
          state.addEdge("USES", node.id, source.id, "calculated", name.includes(".") ? 0.7 : 1);
          state.addEdge(
            "REACHING_DEFINITION",
            source.id,
            node.id,
            "calculated",
            name.includes(".") ? 0.7 : 1,
          );
          state.addEdge("FLOWS_TO", source.id, node.id, "calculated", name.includes(".") ? 0.7 : 1);
        }
      }
      if (
        (ts.isPropertyAccessExpression(ast) || ts.isElementAccessExpression(ast)) &&
        !(
          ts.isBinaryExpression(ast.parent) &&
          ast.parent.left === ast &&
          isAssignmentOperator(ast.parent.operatorToken.kind)
        )
      ) {
        const name = accessPath(ast);
        node.properties = { ...node.properties, variable: name, read: true };
        const source = definitions.get(name);
        if (source) {
          state.addEdge("USES", node.id, source.id, "calculated", 0.7);
          state.addEdge("REACHING_DEFINITION", source.id, node.id, "calculated", 0.7);
          state.addEdge("FLOWS_TO", source.id, node.id, "calculated", 0.7);
        }
      }
      if (ts.isExpression(ast)) {
        const parent = state.nodeByAst.get(ast.parent);
        if (
          parent &&
          (ts.isAwaitExpression(ast.parent) ||
            ts.isYieldExpression(ast.parent) ||
            (ts.isVariableDeclaration(ast.parent) && ast.parent.initializer === ast) ||
            (ts.isParameter(ast.parent) && ast.parent.initializer === ast) ||
            (ts.isBinaryExpression(ast.parent) &&
              ast.parent.right === ast &&
              isAssignmentOperator(ast.parent.operatorToken.kind)) ||
            ts.isConditionalExpression(ast.parent) ||
            (ts.isCallExpression(ast.parent) && ast.parent.arguments.includes(ast)))
        )
          state.addEdge("FLOWS_TO", node.id, parent.id, "calculated");
      }
      if (ts.isReturnStatement(ast)) {
        if (ast.expression) {
          const expression = state.nodeByAst.get(ast.expression);
          if (expression) state.addEdge("FLOWS_TO", expression.id, node.id, "calculated");
        }
        state.addEdge("FLOWS_TO", node.id, state.scopeReturn.id, "calculated");
      }
    }
  }
}

export class CallBindingAnalyzer {
  constructor(
    private readonly nodes: CpgNodeFactory,
    private readonly edges: CpgEdgeFactory,
  ) {}
  bind(artifacts: CpgScopeArtifact[], context: CpgBuildContext): void {
    this.bindProject(artifacts, [context]);
  }
  bindProject(artifacts: CpgScopeArtifact[], contexts: CpgBuildContext[]): void {
    const bySemantic = new Map<string, CpgScopeArtifact>();
    for (const artifact of artifacts)
      if (!bySemantic.has(artifact.descriptor.semanticSymbolId))
        bySemantic.set(artifact.descriptor.semanticSymbolId, artifact);
    const evidenceById = new Map(
      contexts.flatMap((context) => context.evidence).map((item) => [item.id, item]),
    );
    const relationsByFileRange = new Map<string, IntelligenceRelationshipRecord[]>();
    for (const relation of contexts[0]?.relationships ?? []) {
      if (
        !relation.ownerFileId ||
        (relation.type !== "keystone.core.CALLS" && relation.type !== "keystone.core.INSTANTIATES")
      )
        continue;
      for (const evidenceId of relation.evidenceIds) {
        const range = evidenceById.get(evidenceId)?.range;
        if (!range) continue;
        const key = `${relation.ownerFileId}:${rangeKey(range)}`;
        const values = relationsByFileRange.get(key) ?? [];
        values.push(relation);
        relationsByFileRange.set(key, values);
      }
    }
    for (const context of contexts)
      this.bindContext(artifacts, context, bySemantic, relationsByFileRange);
  }
  private bindContext(
    artifacts: CpgScopeArtifact[],
    context: CpgBuildContext,
    bySemantic: ReadonlyMap<string, CpgScopeArtifact>,
    relationsByFileRange: ReadonlyMap<string, IntelligenceRelationshipRecord[]>,
  ): void {
    const callsByRange = new Map<string, ts.CallExpression | ts.NewExpression>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node))
        callsByRange.set(rangeKey(rangeOf(node, context.source)), node);
      ts.forEachChild(node, visit);
    };
    visit(context.source);
    for (const artifact of artifacts.filter(
      (item) => item.descriptor.fileId === context.input.fileId,
    )) {
      const callNodes = artifact.nodes.filter(
        (node) => node.kind === "CALL" || node.kind === "CONSTRUCTOR_CALL",
      );
      for (const call of callNodes) {
        const ast = call.range ? callsByRange.get(rangeKey(call.range)) : undefined;
        const calleeRange =
          ast && (ts.isCallExpression(ast) || ts.isNewExpression(ast))
            ? rangeOf(ast.expression, context.source)
            : call.range;
        const relation = calleeRange
          ? relationsByFileRange.get(`${artifact.descriptor.fileId}:${rangeKey(calleeRange)}`)?.[0]
          : undefined;
        const targetArtifact = relation ? bySemantic.get(relation.targetId) : undefined;
        let targetId: string;
        if (targetArtifact) {
          targetId = targetArtifact.entryNodeId;
          addProxyNode(
            artifact,
            targetArtifact.nodes.find((node) => node.id === targetId),
          );
        } else {
          const external =
            relation?.resolution === "external" ||
            relation?.targetId.includes("ExternalDependency") ||
            isExternalCpgCall(ast, context.program.getTypeChecker()) ||
            isKnownExternalCall(ast);
          const target = this.nodes.create({
            identity: `${call.id}:target`,
            fileId: artifact.descriptor.fileId,
            scopeId: artifact.descriptor.id,
            semanticSymbolId: artifact.descriptor.semanticSymbolId,
            ...(relation ? { referencedSemanticEntityId: relation.targetId } : {}),
            kind: external ? "EXTERNAL_CALL" : "UNRESOLVED_TARGET",
            code: relation ? `target:${relation.targetId}` : "unresolved target",
            evidenceIds: call.evidenceIds,
            parserVersion: artifact.descriptor.providerVersion,
            generation: artifact.descriptor.generation,
            properties: { resolution: relation?.resolution ?? "unresolved" },
          });
          artifact.nodes.push(target);
          targetId = target.id;
          artifact.descriptor.nodeCount += 1;
          if (!relation && !external)
            artifact.diagnostics.push({
              id: cpgStableId("cpg-diagnostic", artifact.descriptor.id, "unresolved-call", call.id),
              code: "unresolved-call",
              severity: "info",
              message:
                "No exact semantic call target was available; no local target was fabricated.",
              fileId: artifact.descriptor.fileId,
              scopeId: artifact.descriptor.id,
              ...(call.range ? { range: call.range } : {}),
              nodeId: call.id,
              confidence: 1,
            });
        }
        const type: CpgEdgeType =
          call.kind === "CONSTRUCTOR_CALL" ? "INSTANTIATES_SYMBOL" : "CALLS_SYMBOL";
        artifact.edges.push(
          this.edges.create({
            sourceId: call.id,
            targetId,
            type,
            derivation: relation ? "resolved" : "calculated",
            confidence: relation?.confidence ?? 1,
            evidenceIds: relation?.evidenceIds ?? call.evidenceIds,
            fileId: artifact.descriptor.fileId,
            scopeId: artifact.descriptor.id,
            generation: artifact.descriptor.generation,
          }),
        );
        if (ast && (ts.isCallExpression(ast) || ts.isNewExpression(ast))) {
          const receiver =
            ts.isPropertyAccessExpression(ast.expression) ||
            ts.isElementAccessExpression(ast.expression)
              ? findNodeByRange(artifact, rangeOf(ast.expression.expression, context.source))
              : undefined;
          if (receiver)
            artifact.edges.push(
              this.edges.create({
                sourceId: receiver.id,
                targetId: call.id,
                type: "RECEIVER_TO_CALL",
                derivation: "calculated",
                confidence: 1,
                evidenceIds: call.evidenceIds,
                fileId: artifact.descriptor.fileId,
                scopeId: artifact.descriptor.id,
                generation: artifact.descriptor.generation,
              }),
            );
          if (targetArtifact) {
            const parameters = targetArtifact.nodes.filter((node) => node.kind === "PARAMETER");
            ast.arguments?.forEach((argument, index) => {
              const argumentNode = findNodeByRange(artifact, rangeOf(argument, context.source));
              const parameter = parameters[index];
              if (argumentNode && parameter) {
                addProxyNode(artifact, parameter);
                artifact.edges.push(
                  this.edges.create({
                    sourceId: argumentNode.id,
                    targetId: parameter.id,
                    type: "ARGUMENT_TO_PARAMETER",
                    derivation: "resolved",
                    confidence: 1,
                    evidenceIds: relation?.evidenceIds ?? call.evidenceIds,
                    fileId: artifact.descriptor.fileId,
                    scopeId: artifact.descriptor.id,
                    generation: artifact.descriptor.generation,
                    properties: { argumentIndex: index },
                  }),
                );
              }
            });
            for (const returned of targetArtifact.nodes.filter((node) => node.kind === "RETURN")) {
              addProxyNode(artifact, returned);
              artifact.edges.push(
                this.edges.create({
                  sourceId: returned.id,
                  targetId: call.id,
                  type: "RETURN_TO_CALL",
                  derivation: "resolved",
                  confidence: 1,
                  evidenceIds: relation?.evidenceIds ?? call.evidenceIds,
                  fileId: artifact.descriptor.fileId,
                  scopeId: artifact.descriptor.id,
                  generation: artifact.descriptor.generation,
                }),
              );
            }
          }
        }
      }
      artifact.edges = [...new Map(artifact.edges.map((edge) => [edge.id, edge])).values()];
      artifact.descriptor.nodeCount = artifact.nodes.length;
      artifact.descriptor.edgeCount = artifact.edges.length;
      artifact.descriptor.summary.unresolvedCalls = artifact.nodes.filter(
        (node) => node.kind === "UNRESOLVED_TARGET",
      ).length;
    }
  }
}

function rangeKey(range: SourceRange): string {
  return `${range.startLine}:${range.startColumn}:${range.endLine}:${range.endColumn}`;
}

function discoverScopes(context: CpgBuildContext): ScopeCandidate[] {
  const candidates: ScopeCandidate[] = [];
  const executableEntities = context.entities.filter(
    (entity) =>
      entity.fileId === context.input.fileId &&
      [
        "keystone.core.Function",
        "keystone.core.Method",
        "keystone.core.Constructor",
        "keystone.core.Component",
        "keystone.core.Hook",
        "keystone.core.Constant",
        "keystone.core.Variable",
      ].includes(entity.type),
  );
  const visit = (node: ts.Node): void => {
    if (isExecutable(node) && node.body) {
      const range = rangeOf(node, context.source);
      const semantic = executableEntities
        .filter((entity) => containsRange(entity.range, range))
        .sort(
          (left, right) =>
            executablePriority(left.type) - executablePriority(right.type) ||
            rangeSize(left.range) - rangeSize(right.range),
        )[0];
      if (semantic)
        candidates.push({
          node,
          body: node.body,
          kind: scopeKind(node),
          name: semantic.qualifiedName,
          semantic,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(context.source);
  const module = context.entities.find(
    (entity) => entity.fileId === context.input.fileId && entity.type === "keystone.core.Module",
  );
  if (module && context.source.statements.some(isModuleExecutableStatement))
    candidates.push({
      node: context.source,
      body: context.source,
      kind: "module",
      name: module.qualifiedName,
      semantic: module,
    });
  return candidates.filter(
    (candidate, index) => candidates.findIndex((other) => other.node === candidate.node) === index,
  );
}

function normalizedKind(node: ts.Node): CpgNodeKind {
  if (ts.isSourceFile(node)) return "FILE";
  if (ts.isModuleDeclaration(node)) return "NAMESPACE";
  if (
    ts.isClassLike(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  )
    return "TYPE_DECLARATION";
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
    return "METHOD";
  if (ts.isFunctionLike(node)) return "FUNCTION";
  if (ts.isParameter(node)) return "PARAMETER";
  if (ts.isBlock(node) && ts.isTryStatement(node.parent) && node.parent.finallyBlock === node)
    return "FINALLY";
  if (ts.isBlock(node)) return "BLOCK";
  if (ts.isIdentifier(node)) return "IDENTIFIER";
  if (
    ts.isLiteralExpression(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  )
    return "LITERAL";
  if (ts.isNewExpression(node)) return "CONSTRUCTOR_CALL";
  if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) return "CALL";
  if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) return "MEMBER_ACCESS";
  if (ts.isElementAccessExpression(node) || ts.isElementAccessChain(node)) return "ELEMENT_ACCESS";
  if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind))
    return "ASSIGNMENT";
  if (ts.isBinaryExpression(node)) return "BINARY_EXPRESSION";
  if (
    ts.isPrefixUnaryExpression(node) ||
    ts.isPostfixUnaryExpression(node) ||
    ts.isDeleteExpression(node) ||
    ts.isTypeOfExpression(node) ||
    ts.isVoidExpression(node)
  )
    return "UNARY_EXPRESSION";
  if (ts.isConditionalExpression(node)) return "CONDITIONAL_EXPRESSION";
  if (ts.isObjectLiteralExpression(node)) return "OBJECT_LITERAL";
  if (ts.isArrayLiteralExpression(node)) return "ARRAY_LITERAL";
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return "TEMPLATE_EXPRESSION";
  if (ts.isAwaitExpression(node)) return "AWAIT";
  if (ts.isYieldExpression(node)) return "YIELD";
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return "TYPE_ASSERTION";
  if (ts.isVariableDeclaration(node)) return "VARIABLE_DECLARATION";
  if (ts.isExpressionStatement(node)) return "EXPRESSION_STATEMENT";
  if (ts.isReturnStatement(node)) return "RETURN_STATEMENT";
  if (ts.isThrowStatement(node)) return "THROW_STATEMENT";
  if (ts.isIfStatement(node)) return "IF";
  if (ts.isSwitchStatement(node)) return "SWITCH";
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return "CASE";
  if (isLoop(node)) return "LOOP";
  if (ts.isBreakStatement(node)) return "BREAK";
  if (ts.isContinueStatement(node)) return "CONTINUE";
  if (ts.isTryStatement(node)) return "TRY";
  if (ts.isCatchClause(node)) return "CATCH";
  return ts.isReturnStatement(node) ? "RETURN" : "BLOCK";
}

function nodeProperties(
  node: ts.Node,
  source: ts.SourceFile,
): { typeName?: string; values: NonNullable<CpgNode["properties"]> } {
  const values: NonNullable<CpgNode["properties"]> = {};
  if (ts.isBinaryExpression(node)) {
    values.operator = node.operatorToken.getText(source);
    if (
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind)
    )
      values.shortCircuit = true;
  }
  if (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    node.questionDotToken
  )
    values.optionalChain = true;
  if (ts.isCallExpression(node) && node.questionDotToken) values.optionalCall = true;
  if (ts.isVariableDeclaration(node))
    values.variable = bindingName(node.name) ?? node.name.getText(source);
  if (ts.isParameter(node)) values.variable = bindingName(node.name) ?? node.name.getText(source);
  if (ts.isIdentifier(node)) values.variable = accessPath(node);
  const type = (node as ts.Node & { type?: ts.TypeNode }).type;
  return { ...(type ? { typeName: sanitizedCode(type, source).slice(0, 500) } : {}), values };
}

function referencedSemanticEntity(
  node: ts.Node,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  entities: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isIdentifier(node) && !ts.isPrivateIdentifier(node)) return undefined;
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  const declaration = symbol.declarations?.[0];
  if (!declaration || declaration.getSourceFile() !== source) return undefined;
  const line = source.getLineAndCharacterOfPosition(declaration.getStart(source)).line;
  return entities.get(`${symbol.getName()}:${line}`);
}
function definitionsFor(node: ts.Node): Array<{ name: string; approximate: boolean }> {
  if (ts.isVariableDeclaration(node))
    return bindingNames(node.name).map((name) => ({ name, approximate: false }));
  if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind))
    return [{ name: accessPath(node.left), approximate: !ts.isIdentifier(node.left) }];
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
  )
    return [{ name: accessPath(node.operand), approximate: !ts.isIdentifier(node.operand) }];
  return [];
}
function isReadIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node)
    return false;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    isAssignmentOperator(parent.operatorToken.kind)
  )
    return parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node)
  )
    return false;
  return true;
}
function accessPath(node: ts.Node): string {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      return `${accessPath(node.parent.expression)}.${node.text}`;
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node))
    return `${accessPath(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node))
    return `${accessPath(node.expression)}[${node.argumentExpression && ts.isLiteralExpression(node.argumentExpression) ? node.argumentExpression.text : "*"}]`;
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) return node.getText();
  return node.getText().replace(/\s+/g, " ").slice(0, 120);
}
function bindingName(node: ts.BindingName): string | undefined {
  return ts.isIdentifier(node) ? node.text : undefined;
}
function bindingNames(node: ts.BindingName): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  return node.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}
function isEvaluated(node: ts.Node): boolean {
  return (
    ts.isExpression(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    ts.isIfStatement(node) ||
    isLoop(node) ||
    ts.isCaseClause(node)
  );
}
function isExecutable(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}
function isNestedExecutable(node: ts.Node): boolean {
  return isExecutable(node);
}
function scopeKind(node: ts.FunctionLikeDeclaration): CpgScopeDescriptor["kind"] {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isGetAccessorDeclaration(node)) return "getter";
  if (ts.isSetAccessorDeclaration(node)) return "setter";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isArrowFunction(node))
    return node.parent && (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
      ? "callback"
      : "arrow";
  if (ts.isFunctionExpression(node)) return "callback";
  return "function";
}
function topStatements(
  body: ts.ConciseBody | ts.Block | ts.SourceFile,
  kind: CpgScopeDescriptor["kind"],
): readonly ts.Statement[] {
  if (ts.isBlock(body)) return body.statements;
  if (ts.isSourceFile(body))
    return kind === "module"
      ? body.statements.filter(isModuleExecutableStatement)
      : body.statements;
  return [];
}
function isModuleExecutableStatement(statement: ts.Statement): boolean {
  return (
    !ts.isImportDeclaration(statement) &&
    !ts.isExportDeclaration(statement) &&
    !ts.isFunctionDeclaration(statement) &&
    !ts.isClassDeclaration(statement) &&
    !ts.isInterfaceDeclaration(statement) &&
    !ts.isTypeAliasDeclaration(statement) &&
    !ts.isEnumDeclaration(statement) &&
    !ts.isModuleDeclaration(statement)
  );
}
function statementList(statement: ts.Statement): readonly ts.Statement[] {
  return ts.isBlock(statement) ? statement.statements : [statement];
}
function isLoop(node: ts.Node): node is ts.IterationStatement {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}
function rangeOf(node: ts.Node, source: ts.SourceFile): SourceRange {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source, false));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line,
    startColumn: start.character,
    endLine: end.line,
    endColumn: end.character,
  };
}
function findNodeByRange(artifact: CpgScopeArtifact, range: SourceRange): CpgNode | undefined {
  return artifact.nodes
    .filter((node) => node.range && containsRange(node.range, range))
    .sort((left, right) => rangeSize(left.range!) - rangeSize(right.range!))[0];
}
function isExternalCpgCall(node: ts.Node | undefined, checker: ts.TypeChecker): boolean {
  return Boolean(
    node &&
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    checker.getResolvedSignature(node)?.declaration?.getSourceFile().isDeclarationFile,
  );
}
function isKnownExternalCall(node: ts.Node | undefined): boolean {
  if (!node || (!ts.isCallExpression(node) && !ts.isNewExpression(node))) return false;
  let expression = node.expression;
  while (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    expression = expression.expression;
  return (
    ts.isIdentifier(expression) &&
    ["Promise", "console", "Math", "JSON", "Object", "Array", "Date", "RegExp", "Reflect"].includes(
      expression.text,
    )
  );
}
function rangeSize(range: SourceRange): number {
  return (range.endLine - range.startLine) * 100000 + range.endColumn - range.startColumn;
}
function structuralText(node: ts.Node, source: ts.SourceFile): string {
  return node
    .getText(source)
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
function sanitizedCode(node: ts.Node, source: ts.SourceFile): string {
  return node
    .getText(source)
    .replace(/"(?:\\.|[^"\\])*"/g, '"<redacted>"')
    .replace(/'(?:\\.|[^'\\])*'/g, "'<redacted>'")
    .replace(/`[\s\S]*?`/g, "`<redacted>`");
}
function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
function executablePriority(type: string): number {
  return [
    "keystone.core.Function",
    "keystone.core.Method",
    "keystone.core.Constructor",
    "keystone.core.Component",
    "keystone.core.Hook",
  ].includes(type)
    ? 0
    : 1;
}
function addProxyNode(artifact: CpgScopeArtifact, node: CpgNode | undefined): void {
  if (node && !artifact.nodes.some((item) => item.id === node.id))
    artifact.nodes.push({ ...node, properties: { ...node.properties, crossScopeProxy: true } });
}
function regenerate(
  artifact: CpgScopeArtifact,
  generation: number,
  sourceHash: string,
): CpgScopeArtifact {
  return {
    descriptor: { ...artifact.descriptor, sourceHash, generation },
    entryNodeId: artifact.entryNodeId,
    exitNodeId: artifact.exitNodeId,
    nodes: artifact.nodes.map((node) => ({ ...node, generation })),
    edges: artifact.edges.map((edge) => ({ ...edge, generation })),
    diagnostics: artifact.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    reused: true,
  };
}
