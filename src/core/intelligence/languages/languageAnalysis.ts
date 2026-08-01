import path from 'node:path';
import type { ApiEndpoint, CodeSymbol, DependencyEdge } from '../../domain/types';
import { LanguageCapabilityRegistry, UNIVERSAL_TEXT_DEFINITION, type LanguageDefinition } from './languageRegistry';
import { parseStructuralSyntax, type StructuralSyntaxTree } from './structuralParser';

export interface LanguageAnalysisResult {
  language: LanguageDefinition;
  symbols: CodeSymbol[];
  dependencies: DependencyEdge[];
  calls: Array<{ caller?: string; callee: string; line: number }>;
  controlFlow: Array<{ kind: string; line: number }>;
  dataFlow: Array<{ source: string; target: string; line: number }>;
  typeRelationships: Array<{ source: string; target: string; kind: 'extends' | 'implements'; line: number }>;
  tests: Array<{ name: string; line: number }>;
  apis: ApiEndpoint[];
  syntaxTree: StructuralSyntaxTree;
}

const registry = new LanguageCapabilityRegistry();
const KEYWORDS = new Set(['if','for','while','switch','catch','return','throw','new','else','do','match','when','case','sizeof','typeof']);

export function analyzeLanguageFile(filePath: string, text: string): LanguageAnalysisResult {
  const language = registry.identify(filePath) ?? identifySpecialFile(filePath) ?? UNIVERSAL_TEXT_DEFINITION;
  const lines = text.split(/\r?\n/);
  const symbols: CodeSymbol[] = [];
  const dependencies: DependencyEdge[] = [];
  const calls: LanguageAnalysisResult['calls'] = [];
  const controlFlow: LanguageAnalysisResult['controlFlow'] = [];
  const dataFlow: LanguageAnalysisResult['dataFlow'] = [];
  const typeRelationships: LanguageAnalysisResult['typeRelationships'] = [];
  const tests: LanguageAnalysisResult['tests'] = [];
  const apis: ApiEndpoint[] = [];
  const seenSymbols = new Set<string>();
  const seenDeps = new Set<string>();
  let currentCallable: string | undefined;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const lineSymbols = symbolMatches(language.id, line);
    for (const match of lineSymbols) {
      const key = `${match.kind}:${match.name}:${lineNo}`;
      if (!seenSymbols.has(key)) {
        seenSymbols.add(key);
        symbols.push({ ...match, filePath, line: lineNo, exportStatus: exportStatus(language.id, line) });
      }
      if (match.kind === 'function' || match.kind === 'method') currentCallable = match.name;
    }
    for (const target of dependencyMatches(language.id, line)) {
      const normalized = normalizeTarget(filePath, target);
      const kind = isLocalTarget(target) ? 'local' as const : 'package' as const;
      const key = `${normalized}:${kind}`;
      if (!seenDeps.has(key)) { seenDeps.add(key); dependencies.push({ from:filePath, to:normalized, kind }); }
    }
    for (const callee of callMatches(language.id, line)) if (!KEYWORDS.has(callee.toLowerCase()) && !lineSymbols.some(symbol => symbol.name === callee.split('.').at(-1))) calls.push({ caller: currentCallable, callee, line: lineNo });
    if (/\b(if|else\s+if|for|foreach|while|switch|case|catch|match|when|try|except|guard)\b/.test(stripStrings(line))) {
      const kind = stripStrings(line).match(/\b(if|else\s+if|for|foreach|while|switch|case|catch|match|when|try|except|guard)\b/)?.[1] ?? 'branch';
      controlFlow.push({ kind, line: lineNo });
    }
    const assignment = stripStrings(line).match(/\b([A-Za-z_$][\w$]*)\s*(?:=|:=|<-|=>)\s*([A-Za-z_$][\w$]*)\b/);
    if (assignment) dataFlow.push({ source: assignment[2], target: assignment[1], line: lineNo });
    if (isTestLine(language.id, line)) tests.push({ name: testName(line) ?? `test@${lineNo}`, line: lineNo });
    for (const relationship of typeRelationshipMatches(language.id, line, lineNo)) typeRelationships.push(relationship);
    const api = apiMatch(language.id, line, filePath, lineNo); if (api) apis.push(api);
  });
  return { language, symbols, dependencies, calls, controlFlow, dataFlow, typeRelationships, tests, apis, syntaxTree: parseStructuralSyntax(language.id, text) };
}

function identifySpecialFile(filePath: string): LanguageDefinition | undefined {
  const name = path.basename(filePath).toLowerCase();
  const id = name === 'dockerfile' ? 'dockerfile' : /^(makefile|justfile)$/.test(name) ? 'make' : name === 'cmakelists.txt' ? 'cmake' : undefined;
  return id ? registry.all().find(item => item.id === id) : undefined;
}

function symbolMatches(id: string, line: string): Array<Pick<CodeSymbol,'name'|'kind'>> {
  const patterns: Array<[CodeSymbol['kind'], RegExp]> = commonPatterns(id);
  const out: Array<Pick<CodeSymbol,'name'|'kind'>> = [];
  for (const [kind, pattern] of patterns) {
    const match = line.match(pattern); const name = match?.groups?.name ?? match?.groups?.name2 ?? match?.[1];
    if (name && !KEYWORDS.has(name.toLowerCase())) out.push({ name, kind });
  }
  return out;
}

function commonPatterns(id: string): Array<[CodeSymbol['kind'], RegExp]> {
  const shared: Array<[CodeSymbol['kind'], RegExp]> = [
    ['class', /\b(?:class|struct|record|object|trait|enum)\s+(?<name>[A-Za-z_$][\w$]*)/],
    ['interface', /\b(?:interface|protocol)\s+(?<name>[A-Za-z_$][\w$]*)/],
    ['type', /\b(?:type|typedef|typealias)\s+(?<name>[A-Za-z_$][\w$]*)/],
  ];
  const byId: Record<string, Array<[CodeSymbol['kind'], RegExp]>> = {
    python: [['function', /^\s*(?:async\s+)?def\s+(?<name>\w+)/]],
    ruby: [['function', /^\s*def\s+(?<name>[\w!?=]+)/]], php: [['function', /\bfunction\s+(?<name>\w+)/]],
    go: [['function', /^\s*func\s+(?:\([^)]*\)\s*)?(?<name>\w+)/]], rust: [['function', /\bfn\s+(?<name>\w+)/]],
    swift: [['function', /\bfunc\s+(?<name>\w+)/]], kotlin: [['function', /\bfun\s+(?<name>\w+)/]], dart: [['function', /\b(?:void|[A-Za-z_]\w*(?:<[^>]+>)?)\s+(?<name>\w+)\s*\(/]],
    java: [['method', /\b(?:public|private|protected|static|final|synchronized|abstract|native|\s)+[\w<>,?\[\]]+\s+(?<name>\w+)\s*\(/]],
    csharp: [['method', /\b(?:public|private|protected|internal|static|virtual|override|async|sealed|\s)+[\w<>,?\[\]]+\s+(?<name>\w+)\s*\(/]],
    c: [['function', /^\s*[\w*\s]+\s+(?<name>\w+)\s*\([^;]*\)\s*\{/]], 'objective-c': [['function', /^\s*[\w*\s]+\s+(?<name>\w+)\s*\([^;]*\)\s*\{/]], cpp: [['function', /^\s*[\w:*&<>\s]+\s+(?<name>\w+)\s*\([^;]*\)\s*(?:const\s*)?\{/]],
    erlang: [['function', /^\s*(?<name>[a-z][\w@]*)\s*\([^)]*\)\s*->/]], haskell: [['function', /^\s*(?<name>[a-z][\w']*)\s+[^=]*=/]], r: [['function', /^\s*(?<name>[A-Za-z.]\w*)\s*<-\s*function\s*\(/]], shell: [['function', /^\s*(?:function\s+)?(?<name>[A-Za-z_]\w*)\s*\(\)\s*\{/]], powershell: [['function', /^\s*function\s+(?<name>[\w-]+)/i]],
    javascript: [
      ['function', /\b(?:function\s+|const\s+|let\s+|var\s+)(?<name>[A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\()/],
      ['method', /^\s*(?:(?:public|private|protected|static|async|get|set|override)\s+)*(?<name>[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\s*\{/],
    ],
    typescript: [
      ['function', /\b(?:function\s+|const\s+|let\s+|var\s+)(?<name>[A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\()/],
      ['method', /^\s*(?:(?:public|private|protected|static|async|readonly|abstract|override|get|set)\s+)*(?<name>[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\s*\{/],
    ],
    sql: [['type', /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(?<name>[\w.]+)/i]],
    graphql: [['type', /^\s*(?:type|input|interface|enum|scalar|union|directive)\s+(?<name>\w+)/]], protobuf: [['type', /^\s*(?:message|enum|service)\s+(?<name>\w+)/]],
    terraform: [['constant', /^\s*(?:resource|data|module|variable|output|provider)\s+"[^"]+"(?:\s+"(?<name>[^"]+)")?/]],
    dockerfile: [['constant', /^\s*FROM\s+\S+\s+AS\s+(?<name>[A-Za-z0-9_.-]+)/i]],
    make: [['function', /^\s*(?<name>[A-Za-z0-9_.-]+)\s*:(?!=)/]], cmake: [['function', /^\s*(?:function|macro|add_executable|add_library)\s*\(\s*(?<name>[A-Za-z0-9_.-]+)/i]],
    gradle: [['function', /^\s*(?:task|register)\s*\(?\s*["']?(?<name>[A-Za-z0-9_.-]+)/]], maven: [['constant', /<artifactId>(?<name>[^<]+)<\/artifactId>/]],
    kubernetes: [['type', /^\s*kind\s*:\s*(?<name>[A-Za-z0-9_.-]+)/]], markdown: [['type', /^\s*#{1,6}\s+(?<name>.+?)\s*$/]],
    html: [['type', /<(?<name>[A-Za-z][\w:-]*)\b/]], xml: [['type', /<(?<name>[A-Za-z][\w:-]*)\b/]],
    css: [['type', /^\s*(?<name>[^@][^{]+)\s*\{/]], json: [['constant', /^\s*"(?<name>[^"]+)"\s*:/]], yaml: [['constant', /^\s*(?<name>[A-Za-z0-9_.-]+)\s*:/]], toml: [['constant', /^\s*(?:\[(?<name>[^\]]+)\]|(?<name2>[A-Za-z0-9_.-]+)\s*=)/]],
  };
  return [...shared, ...(byId[id] ?? [['function', /\b(?:function|func|fn|def|sub|procedure)\s+(?<name>[A-Za-z_$][\w$-]*)/]])];
}


function typeRelationshipMatches(id: string, line: string, lineNo: number): LanguageAnalysisResult['typeRelationships'] {
  const out: LanguageAnalysisResult['typeRelationships'] = [];
  const add = (source: string | undefined, targets: string | undefined, kind: 'extends' | 'implements'): void => {
    if (!source || !targets) return;
    for (const target of targets.split(/\s*,\s*/).map(value => value.replace(/^(?:public|private|protected|virtual)\s+/, '').trim()).filter(Boolean)) {
      const name = target.match(/[A-Za-z_$][\w$.:]*/)?.[0];
      if (name) out.push({ source, target: name.split(/::|\./).at(-1) ?? name, kind, line: lineNo });
    }
  };
  const standard = line.match(/\b(?:class|interface|struct|record|object|trait)\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([^\s{]+(?:\s*,\s*[^\s{]+)*))?(?:\s+implements\s+([^\{]+))?/);
  if (standard) { add(standard[1], standard[2], 'extends'); add(standard[1], standard[3], 'implements'); }
  if (id === 'python') { const match = line.match(/^\s*class\s+([A-Za-z_]\w*)\s*\(([^)]+)\)/); if (match) add(match[1], match[2], 'extends'); }
  if (id === 'cpp' || id === 'c') { const match = line.match(/\bclass\s+([A-Za-z_]\w*)\s*:\s*([^\{]+)/); if (match) add(match[1], match[2], 'extends'); }
  if (id === 'objective-c') { const match = line.match(/@interface\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/); if (match) add(match[1], match[2], 'extends'); }
  if (id === 'csharp' || id === 'kotlin') { const match = line.match(/\bclass\s+([A-Za-z_]\w*)[^:{]*:\s*([^\{]+)/); if (match) { const targets=match[2].split(','); add(match[1], targets.shift(), 'extends'); add(match[1], targets.join(','), 'implements'); } }
  if (id === 'scala') { const match = line.match(/\bclass\s+([A-Za-z_]\w*)[^\{]*\bextends\s+([A-Za-z_]\w*)(.*)/); if (match) { add(match[1], match[2], 'extends'); add(match[1], [...match[3].matchAll(/\bwith\s+([A-Za-z_]\w*)/g)].map(item=>item[1]).join(','), 'implements'); } }
  if (id === 'ruby') { const match = line.match(/\bclass\s+([A-Za-z_]\w*)\s*<\s*([A-Za-z_:]\w*)/); if (match) add(match[1], match[2], 'extends'); }
  if (id === 'rust') { const match = line.match(/\bimpl(?:<[^>]+>)?\s+([A-Za-z_]\w*)\s+for\s+([A-Za-z_]\w*)/); if (match) add(match[2], match[1], 'implements'); }
  if (id === 'swift') { const match = line.match(/\b(?:class|struct|enum)\s+([A-Za-z_]\w*)\s*:\s*([^\{]+)/); if (match) add(match[1], match[2], 'implements'); }
  if (id === 'haskell') { const match = line.match(/^\s*instance\s+([A-Z]\w*)\s+([A-Z]\w*)/); if (match) add(match[2], match[1], 'implements'); }
  if (id === 'elixir') { const match = line.match(/^\s*defimpl\s+([A-Za-z_.]\w*),\s*for:\s*([A-Za-z_.]\w*)/); if (match) add(match[2], match[1], 'implements'); }
  return out;
}

function dependencyMatches(id: string, line: string): string[] {
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bfrom\s+([\w@./:-]+)\s+import\b/g,
    /\brequire\s*\(?["']([^"']+)["']/g,
    /\busing\s+([\w.]+)/g,
    /\b#include\s*[<"]([^>"]+)/g,
    /\buse\s+([\w:]+)/g,
    /\b(?:require_relative|require)\s+["']([^"']+)["']/g,
    /\bsource\s+["']?([^"'\s]+)/g,
  ];
  const out: string[] = [];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const target = match[1];
      if (target && !['if', 'for', 'type'].includes(target)) out.push(target);
    }
  }
  if (id === 'go') {
    const match = line.match(/^\s*["`]([^"`]+)["`]\s*$/);
    if (match) out.push(match[1]);
  }
  return out;
}
function callMatches(_id:string,line:string):string[]{ const clean=stripStrings(line); const out:string[]=[]; for(const m of clean.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) out.push(m[1]); return out; }
function apiMatch(_id:string,line:string,filePath:string,lineNo:number):ApiEndpoint|undefined { const direct=line.match(/\b(?:app|router|server|route)\s*(?:\.|->)\s*(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)/i); if(direct)return{method:direct[1].toUpperCase(),path:direct[2],filePath,line:lineNo}; const annotation=line.match(/@(Get|Post|Put|Patch|Delete|RequestMapping)(?:Mapping)?\s*\(\s*["']([^"']+)/i); if(annotation)return{method:annotation[1].replace(/RequestMapping/i,'ANY').toUpperCase(),path:annotation[2],filePath,line:lineNo}; const attribute=line.match(/\[Http(Get|Post|Put|Patch|Delete)\s*\(\s*["']([^"']+)/i); if(attribute)return{method:attribute[1].toUpperCase(),path:attribute[2],filePath,line:lineNo}; const go=line.match(/HandleFunc\s*\(\s*["']([^"']+)["']/i);return go?{method:'ANY',path:go[1],filePath,line:lineNo}:undefined; }
function isTestLine(id:string,line:string):boolean { return /\b(?:describe|it|test|testcase|assert|expect|@Test|\[Test\]|pytest|unittest|XCTAssert|RSpec)\b/i.test(line) || (id==='go' && /func\s+Test\w+/.test(line)); }
function testName(line:string):string|undefined { return line.match(/(?:describe|it|test|func\s+Test\w*|def\s+test_\w+)\s*\(?\s*["']?([^"'({]+)/i)?.[1]?.trim(); }
function exportStatus(id:string,line:string):CodeSymbol['exportStatus'] { if(/\b(export|public|pub)\b/.test(line)) return 'exported'; if(id==='python' && !/^\s*_/.test(line)) return 'unknown'; return 'local'; }
function isLocalTarget(target:string):boolean { return target.startsWith('.') || target.startsWith('/') || target.includes('::') || target.startsWith('crate::'); }
function normalizeTarget(filePath:string,target:string):string { if(target.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(filePath),target)); return target; }
function stripStrings(line:string):string { return line.replace(/(["'`]).*?\1/g,''); }
