import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { Worker } from "node:worker_threads";

export interface SemanticCallEdge {
  readonly sourcePath: string;
  readonly sourceLine: number;
  readonly callee: string;
  readonly targetPath: string;
  readonly targetLine: number;
  readonly confidence: 1;
}

export interface TypeScriptSemanticResult {
  readonly projectConfig?: string;
  readonly projectConfigs: readonly string[];
  readonly files: number;
  readonly calls: readonly SemanticCallEdge[];
  readonly relationships: readonly SemanticTypeRelationship[];
  readonly callbacks: readonly SemanticCallbackEdge[];
  readonly unresolvedCalls: number;
  readonly diagnostics: number;
  readonly configuredDiagnostics: number;
  readonly fallbackDiagnostics: number;
  readonly configuredFiles: number;
  readonly fallbackFiles: number;
  readonly diagnosticCodes: Readonly<Record<string, number>>;
  readonly diagnosticExamples: readonly string[];
}

export interface SemanticCallbackEdge {
  readonly registrar: string;
  readonly callback: string;
  readonly sourcePath: string;
  readonly sourceLine: number;
  readonly targetPath: string;
  readonly targetLine: number;
  readonly confidence: number;
}

export interface SemanticTypeRelationship {
  readonly kind: "extends" | "implements" | "overrides";
  readonly sourcePath: string;
  readonly sourceLine: number;
  readonly sourceName: string;
  readonly targetPath: string;
  readonly targetLine: number;
  readonly targetName: string;
  readonly confidence: 1;
}

/**
 * Run project-aware TypeScript/JavaScript semantic binding outside the extension-host heap.
 * The synchronous implementation remains exported for focused unit tests and fallback use.
 */
export async function analyzeTypeScriptProjectIsolated(
  workspaceRoot: string,
  sourcePaths: readonly string[],
  signal?: AbortSignal
): Promise<TypeScriptSemanticResult> {
  if (!sourcePaths.length) return analyzeTypeScriptProject(workspaceRoot, sourcePaths);
  const workerPath = path.join(__dirname, "typescriptSemanticWorker.js");
  if (!fs.existsSync(workerPath)) return analyzeTypeScriptProject(workspaceRoot, sourcePaths);
  return new Promise<TypeScriptSemanticResult>((resolve, reject) => {
    const worker = new Worker(workerPath);
    let settled = false;
    let receivedResult = false;
    const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
    const finishWithTermination = (result: TypeScriptSemanticResult): void => {
      if (settled) return;
      settled = true;
      receivedResult = true;
      cleanup();
      // The result has already crossed the worker boundary. Terminate the
      // compiler isolate explicitly rather than depending on TypeScript/Node to
      // leave no referenced worker handles. Resolve only after termination so
      // its heap is released before OKF/CPG promotion continues.
      void worker.terminate().then(
        () => resolve(result),
        (error) => reject(error instanceof Error ? error : new Error(String(error)))
      );
    };
    const rejectAndTerminate = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().finally(() => reject(error));
    };
    const onAbort = (): void =>
      rejectAndTerminate(new Error("TypeScript semantic analysis cancelled."));
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once(
      "message",
      (message: { ok: true; result: TypeScriptSemanticResult } | { ok: false; error: string }) => {
        if (message.ok) finishWithTermination(message.result);
        else rejectAndTerminate(new Error(message.error));
      }
    );
    worker.once("error", (error) =>
      rejectAndTerminate(error instanceof Error ? error : new Error(String(error)))
    );
    worker.once("exit", (code) => {
      if (settled || receivedResult) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          code === 0
            ? "TypeScript semantic worker exited without a result."
            : `TypeScript semantic worker exited with code ${code}.`
        )
      );
    });
    worker.postMessage({ workspaceRoot, sourcePaths: [...sourcePaths] });
  });
}

/** Build project-aware, type-checker-bound call edges for TS/JS sources. */
export function analyzeTypeScriptProject(
  workspaceRoot: string,
  sourcePaths: readonly string[]
): TypeScriptSemanticResult {
  const eligible = new Map(
    sourcePaths.map((file) => [
      normalize(path.resolve(workspaceRoot, file)),
      path.resolve(workspaceRoot, file)
    ])
  );
  const assigned = new Set<string>();
  const configPaths = discoverConfigs(workspaceRoot);
  const programs: Array<{ program: ts.Program; config?: string }> = [];
  for (const configPath of configPaths) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) continue;
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    const rootNames = parsed.fileNames.filter(
      (file) => eligible.has(normalize(file)) && !assigned.has(normalize(file))
    );
    if (!rootNames.length) continue;
    rootNames.forEach((file) => assigned.add(normalize(file)));
    programs.push({
      program: ts.createProgram({
        rootNames,
        options: { ...parsed.options, noEmit: true, skipLibCheck: true }
      }),
      config: configPath
    });
  }
  const remaining = [...eligible.values()].filter((file) => !assigned.has(normalize(file)));
  if (remaining.length)
    programs.push({
      program: ts.createProgram({
        rootNames: remaining,
        options: {
          allowJs: true,
          checkJs: false,
          noEmit: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          moduleResolution: ts.ModuleResolutionKind.Node10,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true
        }
      })
    });
  const calls: SemanticCallEdge[] = [];
  const relationships: SemanticTypeRelationship[] = [];
  const callbacks: SemanticCallbackEdge[] = [];
  let unresolvedCalls = 0;
  let diagnostics = 0;
  let configuredDiagnostics = 0;
  let fallbackDiagnostics = 0;
  let configuredFiles = 0;
  let fallbackFiles = 0;
  const diagnosticCodes: Record<string, number> = {};
  const diagnosticExamples: string[] = [];
  for (const { program, config } of programs) {
    const checker = program.getTypeChecker();
    // Repository intelligence needs compiler-backed binding, not a second full project
    // typecheck. getPreEmitDiagnostics() can trigger expensive whole-program inference
    // that duplicates the explicit SDLC validation/typecheck stage. Capture deterministic
    // syntax/config diagnostics here while the checker is used below for semantic edges.
    const emittedDiagnostics = [
      ...program.getOptionsDiagnostics(),
      ...program.getSyntacticDiagnostics()
    ];
    const programDiagnostics = emittedDiagnostics.length;
    for (const diagnostic of emittedDiagnostics) {
      const code = `TS${diagnostic.code}`;
      diagnosticCodes[code] = (diagnosticCodes[code] ?? 0) + 1;
      if (diagnosticExamples.length < 20) {
        const location =
          diagnostic.file && diagnostic.start !== undefined
            ? `${relative(workspaceRoot, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
            : config
              ? relative(workspaceRoot, config)
              : "fallback";
        diagnosticExamples.push(
          `${location} ${code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`
        );
      }
    }
    diagnostics += programDiagnostics;
    if (config) {
      configuredDiagnostics += programDiagnostics;
      configuredFiles += program.getRootFileNames().length;
    } else {
      fallbackDiagnostics += programDiagnostics;
      fallbackFiles += program.getRootFileNames().length;
    }
    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile || !eligible.has(normalize(sourceFile.fileName))) continue;
      const visit = (node: ts.Node): void => {
        if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
          for (const clause of node.heritageClauses ?? []) {
            for (const heritageType of clause.types) {
              let symbol = checker.getSymbolAtLocation(heritageType.expression);
              if (symbol && symbol.flags & ts.SymbolFlags.Alias)
                symbol = checker.getAliasedSymbol(symbol);
              const declaration = symbol?.declarations?.find((item) =>
                inside(workspaceRoot, item.getSourceFile().fileName)
              );
              if (!declaration) continue;
              const targetFile = declaration.getSourceFile();
              const sourcePosition = sourceFile.getLineAndCharacterOfPosition(
                node.getStart(sourceFile)
              );
              const targetPosition = targetFile.getLineAndCharacterOfPosition(
                declaration.getStart(targetFile)
              );
              relationships.push({
                kind: clause.token === ts.SyntaxKind.ImplementsKeyword ? "implements" : "extends",
                sourcePath: relative(workspaceRoot, sourceFile.fileName),
                sourceLine: sourcePosition.line + 1,
                sourceName: node.name.text,
                targetPath: relative(workspaceRoot, targetFile.fileName),
                targetLine: targetPosition.line + 1,
                targetName: symbol?.getName() ?? heritageType.getText(sourceFile),
                confidence: 1
              });
            }
          }
          if (ts.isClassDeclaration(node)) {
            const classType = checker.getTypeAtLocation(node) as ts.InterfaceType;
            for (const member of node.members) {
              if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name))
                continue;
              for (const base of checker.getBaseTypes(classType) ?? []) {
                const baseMember = base.getProperty(member.name.text);
                const declaration = baseMember?.valueDeclaration ?? baseMember?.declarations?.[0];
                if (!declaration || !inside(workspaceRoot, declaration.getSourceFile().fileName))
                  continue;
                const targetFile = declaration.getSourceFile();
                const sourcePosition = sourceFile.getLineAndCharacterOfPosition(
                  member.getStart(sourceFile)
                );
                const targetPosition = targetFile.getLineAndCharacterOfPosition(
                  declaration.getStart(targetFile)
                );
                relationships.push({
                  kind: "overrides",
                  sourcePath: relative(workspaceRoot, sourceFile.fileName),
                  sourceLine: sourcePosition.line + 1,
                  sourceName: `${node.name.text}.${member.name.text}`,
                  targetPath: relative(workspaceRoot, targetFile.fileName),
                  targetLine: targetPosition.line + 1,
                  targetName: `${containerName(declaration)}.${baseMember?.getName() ?? member.name.text}`,
                  confidence: 1
                });
              }
            }
          }
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const signature = checker.getResolvedSignature(node);
          const declaration = signature?.declaration;
          if (declaration && inside(workspaceRoot, declaration.getSourceFile().fileName)) {
            const targetFile = declaration.getSourceFile();
            const sourcePosition = sourceFile.getLineAndCharacterOfPosition(
              node.getStart(sourceFile)
            );
            const targetPosition = targetFile.getLineAndCharacterOfPosition(
              declaration.getStart(targetFile)
            );
            calls.push({
              sourcePath: relative(workspaceRoot, sourceFile.fileName),
              sourceLine: sourcePosition.line + 1,
              callee: node.expression.getText(sourceFile),
              targetPath: relative(workspaceRoot, targetFile.fileName),
              targetLine: targetPosition.line + 1,
              confidence: 1
            });
          } else unresolvedCalls += 1;
          if (ts.isCallExpression(node)) {
            for (const argument of node.arguments) {
              const callbackDeclaration = callbackTarget(argument, checker);
              if (
                !callbackDeclaration ||
                !inside(workspaceRoot, callbackDeclaration.getSourceFile().fileName)
              )
                continue;
              const targetFile = callbackDeclaration.getSourceFile();
              const sourcePosition = sourceFile.getLineAndCharacterOfPosition(
                node.getStart(sourceFile)
              );
              const targetPosition = targetFile.getLineAndCharacterOfPosition(
                callbackDeclaration.getStart(targetFile)
              );
              callbacks.push({
                registrar: node.expression.getText(sourceFile),
                callback: callbackName(argument, callbackDeclaration),
                sourcePath: relative(workspaceRoot, sourceFile.fileName),
                sourceLine: sourcePosition.line + 1,
                targetPath: relative(workspaceRoot, targetFile.fileName),
                targetLine: targetPosition.line + 1,
                confidence:
                  ts.isArrowFunction(argument) || ts.isFunctionExpression(argument) ? 1 : 0.9
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
  const usedConfigs = programs.flatMap((item) =>
    item.config ? [relative(workspaceRoot, item.config)] : []
  );
  return {
    projectConfig: usedConfigs[0],
    projectConfigs: usedConfigs,
    files: eligible.size,
    calls: dedupe(calls),
    relationships: dedupeRelationships(relationships),
    callbacks: dedupeCallbacks(callbacks),
    unresolvedCalls,
    diagnostics,
    configuredDiagnostics,
    fallbackDiagnostics,
    configuredFiles,
    fallbackFiles,
    diagnosticCodes,
    diagnosticExamples
  };
}

function callbackTarget(
  argument: ts.Expression,
  checker: ts.TypeChecker
): ts.Declaration | undefined {
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return argument;
  if (!ts.isIdentifier(argument) && !ts.isPropertyAccessExpression(argument)) return undefined;
  if (checker.getTypeAtLocation(argument).getCallSignatures().length === 0) return undefined;
  let symbol = checker.getSymbolAtLocation(argument);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function callbackName(argument: ts.Expression, declaration: ts.Declaration): string {
  if (ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument))
    return argument.getText();
  const name = (declaration as ts.NamedDeclaration).name;
  if (name && ts.isIdentifier(name)) return name.text;
  return "<anonymous>";
}

function dedupeCallbacks(items: SemanticCallbackEdge[]): SemanticCallbackEdge[] {
  return [
    ...new Map(
      items.map((item) => [
        `${item.sourcePath}:${item.sourceLine}:${item.registrar}:${item.targetPath}:${item.targetLine}:${item.callback}`,
        item
      ])
    ).values()
  ];
}

function containerName(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if ((ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current)) && current.name)
      return current.name.text;
    current = current.parent;
  }
  return "base";
}

function discoverConfigs(workspaceRoot: string): string[] {
  try {
    return fs
      .readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^tsconfig(?:\.[^.]+)?\.json$/i.test(entry.name))
      .filter((entry) => !/\.eslint\.json$/i.test(entry.name))
      .map((entry) => path.join(workspaceRoot, entry.name))
      .sort((a, b) => configPriority(a) - configPriority(b) || a.localeCompare(b));
  } catch {
    return [];
  }
}

function configPriority(configPath: string): number {
  const name = path.basename(configPath).toLowerCase();
  if (name.includes("webview")) return 0;
  if (name.includes("extension-test")) return 1;
  if (name === "tsconfig.json") return 2;
  return 3;
}

function dedupeRelationships(items: SemanticTypeRelationship[]): SemanticTypeRelationship[] {
  return [
    ...new Map(
      items.map((item) => [
        `${item.kind}:${item.sourcePath}:${item.sourceLine}:${item.targetPath}:${item.targetLine}`,
        item
      ])
    ).values()
  ];
}

function dedupe(calls: SemanticCallEdge[]): SemanticCallEdge[] {
  return [
    ...new Map(
      calls.map((call) => [
        `${call.sourcePath}:${call.sourceLine}:${call.targetPath}:${call.targetLine}`,
        call
      ])
    ).values()
  ];
}

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function normalize(file: string): string {
  return path.resolve(file).split(path.sep).join("/");
}
