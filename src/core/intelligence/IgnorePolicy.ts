export interface IgnorePolicy {
  isExcluded(path: string, category?: FileCategory): boolean;
  isSecret(path: string, content?: string): boolean;
  isBinary(content: Uint8Array): boolean;
  isGenerated(path: string, content?: string): boolean;
  classify(path: string, content?: string): FileCategory;
}

export type FileCategory = "source" | "test" | "config" | "manifest" | "documentation" | "other";

export class DefaultIgnorePolicy implements IgnorePolicy {
  private readonly hardExcludedPatterns = [
    /\.git\//,
    /\.hg\//,
    /\.svn\//,
    /\.cargo\/registry\//,
    /node_modules\//,
    /vendor\//,
    /\.vscode\/extensions\//,
    /\.vscode-insiders\/extensions\//,
    /\.vscode-exploration\/extensions\//
  ];

  private readonly secretPatterns = [
    /\.env(\..+)?$/,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /\.jks$/,
    /credentials\.json$/,
    /\.netrc$/,
    /id_rsa$/,
    /id_ed25519$/,
    /\.aws\/credentials$/,
    /\.ssh\/authorized_keys$/,
    /\.ssh\/known_hosts$/,
    /token\.txt$/,
    /\.token$/,
    /\.credentials$/,
    /\.secret$/,
    /\.secret\.json$/,
    /\.htpasswd$/,
    /\.pgpass$/,
    /\.netrc$/,
    /\.npmrc$/,
    /\.pypirc$/,
    /\.pypirc$/,
    /\.npmrc$/,
    /\.gitlab-ci\.yml$/,
    /\.circleci\/config\.yml$/,
    /\.travis\.yml$/,
    /\.github\/workflows\//,
    /\.gitlab\/ci\.yml$/,
    /\.travis\.yml$/,
    /\.circleci\/config\.yml$/,
    /\.github\/workflows\//,
    /\.gitlab\/ci\.yml$/,
    /secrets\.(yml|yaml|json|toml|env)/,
    /credentials\.(yml|yaml|json|toml|env)/,
    /config\.(yml|yaml|json|toml|env)$/,
    /settings\.(yml|yaml|json|toml|env)$/,
    /passwords\.(yml|yaml|json|toml|env)/,
    /tokens\.(yml|yaml|json|toml|env)/
  ];

  private readonly binaryExtensions = [
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".o", ".a", ".lib",
    ".class", ".pyc", ".pyo", ".pyd",
    ".woff", ".woff2", ".ttf", ".eot",
    ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv",
    ".iso", ".dmg", ".pkg", ".deb", ".rpm",
    ".bin", ".dat", ".db", ".sqlite", ".sqlite3"
  ];

  private readonly generatedPatterns = [
    /\.min\.(js|css)$/,
    /\.map$/,
    /__pycache__\//,
    /\.pyc$/,
    /\.pyo$/,
    /\.pyd$/,
    /\.egg-info\//,
    /dist\//,
    /build\//,
    /out\//,
    /\.next\//,
    /\.nuxt\//,
    /\.svelte-kit\//,
    /\.astro\//,
    /coverage\//,
    /\.nyc_output\//,
    /test-results\//,
    /\.turbo\//,
    /node_modules\//,
    /vendor\//,
    /__tests__\//,
    /\.spec\.(js|ts|jsx|tsx)$/,
    /\.test\.(js|ts|jsx|tsx)$/
  ];

  isExcluded(path: string, category?: FileCategory): boolean {
    for (const pattern of this.hardExcludedPatterns) {
      if (pattern.test(path)) return true;
    }
    return false;
  }

  isSecret(path: string, content?: string): boolean {
    for (const pattern of this.secretPatterns) {
      if (pattern.test(path)) return true;
    }
    return false;
  }

  isBinary(content: Uint8Array): boolean {
    if (content.length === 0) return false;
    const chunk = content.slice(0, Math.min(512, content.length));
    let nullBytes = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0) nullBytes++;
    }
    return nullBytes > chunk.length * 0.1;
  }

  isGenerated(path: string, content?: string): boolean {
    for (const pattern of this.generatedPatterns) {
      if (pattern.test(path)) return true;
    }
    if (content && content.length > 100_000) return true;
    return false;
  }

  classify(path: string, content?: string): FileCategory {
    const lower = path.toLowerCase();
    if (lower.endsWith(".test.js") || lower.endsWith(".test.ts") || lower.endsWith(".spec.js") ||
        lower.endsWith(".spec.ts") || lower.endsWith(".test.jsx") || lower.endsWith(".test.tsx") ||
        lower.includes("/__tests__/") || lower.includes("/tests/")) {
      return "test";
    }
    if (lower.endsWith(".json") || lower.endsWith(".json5") || lower.endsWith(".yaml") ||
        lower.endsWith(".yml") || lower.endsWith(".toml") || lower.endsWith(".xml") ||
        lower.endsWith(".env") || lower.endsWith(".envrc") || lower.endsWith(".editorconfig") ||
        lower.endsWith(".prettierrc") || lower.endsWith(".eslintrc") || lower.endsWith(".babelrc") ||
        lower.endsWith(".vscode") || lower.endsWith("tsconfig") || lower.endsWith("jsconfig")) {
      return "config";
    }
    if (lower.endsWith("package.json") || lower.endsWith("Cargo.toml") || lower.endsWith("go.mod") ||
        lower.endsWith("pom.xml") || lower.endsWith("build.gradle") || lower.endsWith("requirements.txt") ||
        lower.endsWith("setup.py") || lower.endsWith("pyproject.toml") || lower.endsWith("composer.json") ||
        lower.endsWith("Gemfile") || lower.endsWith("Makefile") || lower.endsWith("CMakeLists.txt") ||
        lower.endsWith("go.sum") || lower.endsWith("package-lock.json") || lower.endsWith("yarn.lock") ||
        lower.endsWith("pnpm-lock.yaml") || lower.endsWith("pnpm-workspace.yaml")) {
      return "manifest";
    }
    if (lower.endsWith(".md") || lower.endsWith(".rst") || lower.endsWith(".txt") ||
        lower.endsWith(".adoc") || lower.endsWith(".org")) {
      return "documentation";
    }
    return "other";
  }
}
