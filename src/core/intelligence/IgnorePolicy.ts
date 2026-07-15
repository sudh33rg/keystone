import type { ClassificationDecision, IntelligenceFileCategory } from "../../shared/contracts/intelligence";
import { normalizeRelativePath } from "./StableId";

export type FileCategory = IntelligenceFileCategory;

export interface IgnorePolicy {
  decide(path: string, content?: Uint8Array): ClassificationDecision;
  isExcluded(path: string, category?: FileCategory): boolean;
  isSecret(path: string, content?: string): boolean;
  isBinary(content: Uint8Array): boolean;
  isGenerated(path: string, content?: string): boolean;
  classify(path: string, content?: string): FileCategory;
}

const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hpp", ".java", ".js", ".jsx", ".kt", ".kts",
  ".php", ".py", ".rb", ".rs", ".scala", ".swift", ".ts", ".tsx", ".vue", ".svelte"
]);

const BINARY_EXTENSIONS = new Set([
  ".7z", ".a", ".avi", ".bin", ".bmp", ".bz2", ".class", ".dat", ".db", ".deb", ".dll",
  ".dmg", ".doc", ".docx", ".eot", ".exe", ".flv", ".gif", ".gz", ".ico", ".iso", ".jar",
  ".jpeg", ".jpg", ".lib", ".mov", ".mp3", ".mp4", ".o", ".obj", ".pdf", ".pkg", ".png",
  ".ppt", ".pptx", ".pyd", ".pyc", ".pyo", ".rar", ".rpm", ".so", ".sqlite", ".sqlite3",
  ".tar", ".ttf", ".war", ".webp", ".woff", ".woff2", ".wmv", ".xls", ".xlsx", ".zip"
]);

const ASSET_EXTENSIONS = new Set([".css", ".less", ".sass", ".scss", ".svg"]);
const DOCUMENTATION_EXTENSIONS = new Set([".adoc", ".md", ".mdx", ".org", ".rst", ".txt"]);
const CONFIG_EXTENSIONS = new Set([".ini", ".json", ".json5", ".toml", ".xml", ".yaml", ".yml"]);

export class DefaultIgnorePolicy implements IgnorePolicy {
  decide(inputPath: string, content?: Uint8Array): ClassificationDecision {
    const path = normalizeRelativePath(inputPath);
    const lower = path.toLowerCase();
    const name = lower.split("/").at(-1) ?? lower;
    const extension = extensionOf(name);

    if (lower === ".keystone" || lower.startsWith(".keystone/")) return decision("other", "excluded", false, true, false, false, "exclude.keystone-intelligence", "Keystone-generated intelligence is monitored separately and never ingested as repository source.");
    if (isTestPath(lower)) return decision("test", "deep", true, false, false, false, "include.test", "Tests are first-class source intelligence.");
    if (isSensitivePath(lower)) return decision("configuration", "metadata-only", true, false, false, true, "sensitive.metadata", "Sensitive file content is not read or persisted.");
    if (isDependencyOrOutputPath(lower)) return decision("other", "excluded", false, true, false, false, "exclude.directory", "Dependency, cache, temporary, or generated output directory.");
    if (isMinifiedOrGenerated(lower)) return decision("asset", "excluded", false, true, false, false, "exclude.generated", "Generated or minified file.");
    if (BINARY_EXTENSIONS.has(extension) || (content !== undefined && this.isBinary(content))) {
      return decision("asset", "excluded", false, false, true, false, "exclude.binary", "Binary, archive, media, or office artifact.");
    }
    if (isCiPath(lower)) return decision("ci", "structural", true, false, false, false, "include.ci", "Continuous-integration configuration is included.");
    if (isInfrastructurePath(lower, name, extension)) return decision("infrastructure", "structural", true, false, false, false, "include.infrastructure", "Infrastructure definition is included.");
    if (isMigrationPath(lower)) return decision("migration", "structural", true, false, false, false, "include.migration", "Database migration is included.");
    if (isSchemaPath(lower, name, extension)) return decision("schema", "structural", true, false, false, false, "include.schema", "API, ORM, or data schema is included.");
    if (isManifest(name, lower)) return decision("manifest", "structural", true, false, false, false, "include.manifest", "Build or package manifest is included.");
    if (DOCUMENTATION_EXTENSIONS.has(extension)) return decision("documentation", "structural", true, false, false, false, "include.documentation", "Documentation is included.");
    if (SOURCE_EXTENSIONS.has(extension)) return decision("source", "deep", true, false, false, false, "include.source", "Supported source file.");
    if (ASSET_EXTENSIONS.has(extension)) return decision("asset", "metadata-only", true, false, false, false, "include.asset-metadata", "Ordinary static asset is metadata-only.");
    if (CONFIG_EXTENSIONS.has(extension) || isSourceConfiguration(name)) return decision("configuration", "structural", true, false, false, false, "include.configuration", "Source configuration is included.");
    return decision("other", "metadata-only", true, false, false, false, "include.metadata", "Unsupported file retained as metadata.");
  }

  isExcluded(path: string): boolean {
    return !this.decide(path).included;
  }

  isSecret(path: string): boolean {
    return this.decide(path).sensitive;
  }

  isBinary(content: Uint8Array): boolean {
    if (content.length === 0) return false;
    const chunk = content.subarray(0, Math.min(8192, content.length));
    let suspicious = 0;
    for (const byte of chunk) {
      if (byte === 0) return true;
      if (byte < 7 || (byte > 13 && byte < 32)) suspicious++;
    }
    return suspicious / chunk.length > 0.1;
  }

  isGenerated(path: string): boolean {
    return this.decide(path).generated;
  }

  classify(path: string): FileCategory {
    return this.decide(path).category;
  }
}

function decision(
  category: FileCategory,
  analysisLevel: ClassificationDecision["analysisLevel"],
  included: boolean,
  generated: boolean,
  binary: boolean,
  sensitive: boolean,
  ruleId: string,
  reason: string
): ClassificationDecision {
  return { category, analysisLevel, included, generated, binary, sensitive, ruleId, reason };
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(path) || /\.(spec|test)\.[^.]+$/.test(path);
}

function isSensitivePath(path: string): boolean {
  const name = path.split("/").at(-1) ?? path;
  return /^\.env(?:\..+)?$/.test(name) || /\.(pem|key|p12|pfx|jks)$/.test(name) ||
    /^(id_rsa|id_ed25519|credentials(?:\..+)?|secrets?(?:\..+)?|tokens?(?:\..+)?)$/.test(name) ||
    /(^|\/)(\.aws\/credentials|\.ssh\/(?:authorized_keys|known_hosts)|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.htpasswd)$/.test(path);
}

function isDependencyOrOutputPath(path: string): boolean {
  return /(^|\/)(\.git|\.hg|\.svn|node_modules|vendor|bower_components|dist|build|out|bin|obj|target|coverage|\.coverage|\.nyc_output|test-results|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.cache|\.turbo|\.next|\.nuxt|\.svelte-kit|\.astro|\.gradle|\.idea|\.venv|venv|env|tmp|temp)(\/|$)/.test(path);
}

function isMinifiedOrGenerated(path: string): boolean {
  return /\.min\.(?:js|css)$/.test(path) || /\.map$/.test(path) || /(^|\/)generated(\/|$)/.test(path) || /\.g\.[^.]+$/.test(path);
}

function isCiPath(path: string): boolean {
  return /(^|\/)\.github\/workflows\//.test(path) || /(^|\/)\.circleci\//.test(path) ||
    /(^|\/)(\.gitlab-ci\.ya?ml|\.travis\.ya?ml|azure-pipelines\.ya?ml|jenkinsfile)$/.test(path);
}

function isInfrastructurePath(path: string, name: string, extension: string): boolean {
  return extension === ".tf" || extension === ".tfvars" || /^dockerfile(?:\..+)?$/.test(name) ||
    /^compose(?:\..+)?\.ya?ml$/.test(name) || /(^|\/)(k8s|kubernetes|helm|terraform)(\/|$)/.test(path);
}

function isMigrationPath(path: string): boolean {
  return /(^|\/)(migrations?|db\/migrate)(\/|$)/.test(path);
}

function isSchemaPath(path: string, name: string, extension: string): boolean {
  return extension === ".graphql" || extension === ".gql" || extension === ".sql" || extension === ".prisma" ||
    /(^|\/)(openapi|swagger)(?:\.[^/]+)?$/.test(path) || /(^|\/)(schema|schemas)(\/|$)/.test(path) ||
    /^(openapi|swagger)\.ya?ml$/.test(name);
}

function isManifest(name: string, path: string): boolean {
  return new Set([
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pnpm-workspace.yaml", "cargo.toml",
    "cargo.lock", "go.mod", "go.sum", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle",
    "requirements.txt", "setup.py", "pyproject.toml", "poetry.lock", "composer.json", "gemfile", "gemfile.lock",
    "makefile", "cmakelists.txt", "meson.build"
  ]).has(name) || /(^|\/)gradle\/.*\.toml$/.test(path);
}

function isSourceConfiguration(name: string): boolean {
  return /^(tsconfig|jsconfig)(?:\..+)?\.json$/.test(name) || /^\.(editorconfig|prettierrc|eslintrc|babelrc)(?:\..+)?$/.test(name);
}
