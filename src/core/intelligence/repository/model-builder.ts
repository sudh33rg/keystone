import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  BuildDefinition,
  FrameworkSummary,
  LanguageSummary,
  RepositoryDependency,
  RepositoryDocumentation,
  RepositoryImport,
  RepositoryModel,
  RepositoryPackage,
  RepositorySymbol,
  RepositorySymbolKind,
  SourceFile
} from './model';
import { IGNORED_DIRECTORIES } from '../../platform/config/defaults';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml'
};

export class RepositoryModelBuilder {
  private excludedPaths: string[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  getExcludedPaths(): readonly string[] { return [...this.excludedPaths]; }

  build(rootPath: string): RepositoryModel {
    const absoluteRoot = path.resolve(rootPath);
    const repositoryId = stableId('repository', absoluteRoot);
    const files = this.discoverFiles(absoluteRoot)
      .map(filePath => this.buildSourceFile(repositoryId, absoluteRoot, filePath));
    const symbols = files.flatMap(file => file.symbols);
    const dependencies = [
      ...files.flatMap(file => this.importDependencies(repositoryId, file)),
      ...this.packageDependencies(repositoryId, absoluteRoot)
    ];

    return deepFreeze({
      id: repositoryId,
      name: path.basename(absoluteRoot),
      rootPath: absoluteRoot,
      type: fs.existsSync(path.join(absoluteRoot, '.git')) ? 'git' : 'local',
      version: stableId('model-version', files.map(file => file.checksum).sort().join('|')),
      createdAt: this.clock().toISOString(),
      git: undefined,
      modules: this.modulesFor(repositoryId, absoluteRoot, files),
      packages: this.packagesFor(repositoryId, absoluteRoot),
      projects: [],
      directories: this.directoriesFor(repositoryId, absoluteRoot, files),
      files,
      symbols,
      dependencies,
      languages: this.languagesFor(files),
      frameworks: this.frameworksFor(absoluteRoot),
      buildMetadata: this.buildMetadataFor(repositoryId, absoluteRoot),
      documentation: this.documentationFor(repositoryId, files)
    });
  }

  private discoverFiles(rootPath: string): string[] {
    const results: string[] = [];
    this.excludedPaths = [];
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { this.excludedPaths.push(normalizePath(path.relative(rootPath, dir)) || '.'); return; }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) {
            walk(path.join(dir, entry.name));
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const absolutePath = path.join(dir, entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (LANGUAGE_BY_EXTENSION[ext]) {
          try {
            if (fs.statSync(absolutePath).size > 5_000_000) { this.excludedPaths.push(normalizePath(path.relative(rootPath, absolutePath))); continue; }
          } catch { this.excludedPaths.push(normalizePath(path.relative(rootPath, absolutePath))); continue; }
          results.push(absolutePath);
        }
      }
    };
    walk(rootPath);
    return results.sort();
  }

  private buildSourceFile(repositoryId: string, rootPath: string, absolutePath: string): SourceFile {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const relativePath = normalizePath(path.relative(rootPath, absolutePath));
    const fileId = stableId('file', repositoryId, relativePath);
    const language = LANGUAGE_BY_EXTENSION[path.extname(absolutePath).toLowerCase()] ?? 'unknown';
    const imports = this.extractImports(fileId, relativePath, content, language);
    const fileSymbols = this.extractSymbols(repositoryId, fileId, relativePath, content, language);
    return {
      id: fileId,
      repositoryId,
      path: relativePath,
      absolutePath,
      language,
      checksum: hash(content),
      size: Buffer.byteLength(content, 'utf-8'),
      lineCount: content.split(/\r?\n/).length,
      symbols: fileSymbols,
      imports
    };
  }

  private extractImports(fileId: string, sourcePath: string, content: string, language: string): RepositoryImport[] {
    const patterns = language === 'python'
      ? [/^\s*import\s+([A-Za-z0-9_.-]+)/gm, /^\s*from\s+([A-Za-z0-9_.-]+)\s+import\s+/gm]
      : [/import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g, /require\(\s*['"]([^'"]+)['"]\s*\)/g];
    const imports: RepositoryImport[] = [];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        imports.push({
          id: stableId('import', fileId, match[1], String(match.index)),
          sourceFileId: fileId,
          sourcePath,
          target: match[1],
          line: content.slice(0, match.index).split(/\r?\n/).length
        });
      }
    }
    return imports;
  }

  private extractSymbols(
    repositoryId: string,
    fileId: string,
    sourcePath: string,
    content: string,
    language: string
  ): RepositorySymbol[] {
    const patterns: Array<{ kind: RepositorySymbolKind; pattern: RegExp }> = language === 'python'
      ? [
        { kind: 'class', pattern: /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/gm },
        { kind: 'function', pattern: /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/gm }
      ]
      : [
        { kind: 'class', pattern: /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
        { kind: 'interface', pattern: /\binterface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
        { kind: 'type', pattern: /\btype\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
        { kind: 'function', pattern: /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
        { kind: 'constant', pattern: /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)/g }
      ];

    const symbols: RepositorySymbol[] = [];
    for (const { kind, pattern } of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const before = content.slice(0, match.index);
        const line = before.split(/\r?\n/).length;
        const column = before.length - before.lastIndexOf('\n');
        symbols.push({
          id: stableId('symbol', fileId, match[1], kind, String(line)),
          repositoryId,
          fileId,
          name: match[1],
          kind,
          location: {
            path: sourcePath,
            line,
            column
          }
        });
      }
    }
    return symbols;
  }

  private importDependencies(repositoryId: string, file: SourceFile): RepositoryDependency[] {
    return file.imports.map(item => ({
      id: stableId('dependency', item.sourceFileId, item.target),
      repositoryId,
      sourceAssetId: item.sourceFileId,
      target: item.target,
      dependencyType: 'import',
      scope: 'unknown',
      evidence: [`${item.sourcePath}:${item.line}`]
    }));
  }

  private packageDependencies(repositoryId: string, rootPath: string): RepositoryDependency[] {
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return [];
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const dependencies: RepositoryDependency[] = [];
    const add = (source: Record<string, string> | undefined, scope: RepositoryDependency['scope']): void => {
      for (const [name, version] of Object.entries(source ?? {})) {
        dependencies.push({
          id: stableId('dependency', repositoryId, name, scope),
          repositoryId,
          sourceAssetId: repositoryId,
          target: name,
          dependencyType: 'package',
          scope,
          evidence: [`package.json:${name}@${version}`]
        });
      }
    };
    add(pkg.dependencies, 'runtime');
    add(pkg.devDependencies, 'development');
    add(pkg.peerDependencies, 'peer');
    add(pkg.optionalDependencies, 'optional');
    return dependencies;
  }

  private packagesFor(repositoryId: string, rootPath: string): RepositoryPackage[] {
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return [];
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: string; version?: string; packageManager?: string };
    return [{
      id: stableId('package', repositoryId, pkg.name ?? path.basename(rootPath)),
      name: pkg.name ?? path.basename(rootPath),
      path: 'package.json',
      version: pkg.version,
      packageManager: pkg.packageManager
    }];
  }

  private modulesFor(repositoryId: string, rootPath: string, files: readonly SourceFile[]) {
    return [...new Set(files.map(file => file.path.split('/')[0]).filter(Boolean))]
      .map(name => ({
        id: stableId('module', repositoryId, name),
        name,
        path: path.join(rootPath, name)
      }));
  }

  private directoriesFor(repositoryId: string, rootPath: string, files: readonly SourceFile[]) {
    const dirs = new Set<string>();
    for (const file of files) {
      const dir = path.dirname(file.path);
      if (dir !== '.') dirs.add(dir);
    }
    return [...dirs].sort().map(dir => ({
      id: stableId('directory', repositoryId, dir),
      path: dir,
      parentPath: path.dirname(dir) === '.' ? undefined : path.dirname(dir)
    }));
  }

  private languagesFor(files: readonly SourceFile[]): LanguageSummary[] {
    const byLanguage = new Map<string, { files: number; bytes: number }>();
    for (const file of files) {
      const current = byLanguage.get(file.language) ?? { files: 0, bytes: 0 };
      current.files += 1;
      current.bytes += file.size;
      byLanguage.set(file.language, current);
    }
    return [...byLanguage.entries()].map(([language, stats]) => ({ language, ...stats }));
  }

  private frameworksFor(rootPath: string): FrameworkSummary[] {
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return [];
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const known: Record<string, FrameworkSummary['category']> = {
      react: 'frontend',
      vue: 'frontend',
      angular: 'frontend',
      express: 'backend',
      fastify: 'backend',
      jest: 'testing',
      vitest: 'testing',
      mocha: 'testing',
      typescript: 'build',
      webpack: 'build',
      vite: 'build'
    };
    return Object.keys(deps)
      .filter(name => known[name])
      .map(name => ({
        name,
        category: known[name],
        evidence: [`package.json:${name}`]
      }));
  }

  private buildMetadataFor(repositoryId: string, rootPath: string): BuildDefinition[] {
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return [];
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { scripts?: Record<string, string> };
    return Object.entries(pkg.scripts ?? {}).map(([name, command]) => ({
      id: stableId('build', repositoryId, name),
      command,
      description: name,
      source: 'package.json'
    }));
  }

  private documentationFor(repositoryId: string, files: readonly SourceFile[]): RepositoryDocumentation[] {
    return files
      .filter(file => file.language === 'markdown')
      .map(file => ({
        id: stableId('documentation', repositoryId, file.path),
        path: file.path,
        title: path.basename(file.path),
        checksum: file.checksum
      }));
  }
}

function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function stableId(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}
