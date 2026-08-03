export type CapabilityLevel = "universal" | "structural" | "semantic" | "deep";
export interface LanguageCapabilities {
  parsing: CapabilityLevel;
  symbols: CapabilityLevel;
  imports: CapabilityLevel;
  calls: CapabilityLevel;
  controlFlow: CapabilityLevel;
  dataFlow: CapabilityLevel;
  cpg: CapabilityLevel;
  tests: CapabilityLevel;
}
export interface LanguageDefinition {
  id: string;
  label: string;
  extensions: readonly string[];
  capabilities: LanguageCapabilities;
  families?: readonly string[];
  parser: "typescript" | "deterministic-adapter" | "artifact";
  frontend:
    | "typescript-compiler"
    | "brace-grammar"
    | "indent-grammar"
    | "functional-grammar"
    | "shell-grammar"
    | "schema-grammar"
    | "markup-grammar"
    | "data-grammar"
    | "infrastructure-grammar"
    | "universal-text-grammar";
  conformance: "compiler-backed" | "deterministic-grammar" | "structural-artifact";
  baseline: "compiler" | "deterministic-structural" | "structural-artifact" | "universal-text";
  semanticEnrichment: "built-in" | "vscode-language-service";
}
const deep: LanguageCapabilities = {
  parsing: "deep",
  symbols: "deep",
  imports: "deep",
  calls: "deep",
  controlFlow: "semantic",
  dataFlow: "semantic",
  cpg: "deep",
  tests: "semantic"
};
const deterministic: LanguageCapabilities = {
  parsing: "structural",
  symbols: "structural",
  imports: "structural",
  calls: "structural",
  controlFlow: "structural",
  dataFlow: "universal",
  cpg: "structural",
  tests: "structural"
};
const structural: LanguageCapabilities = {
  parsing: "structural",
  symbols: "structural",
  imports: "structural",
  calls: "structural",
  controlFlow: "structural",
  dataFlow: "universal",
  cpg: "structural",
  tests: "structural"
};
const artifact: LanguageCapabilities = {
  parsing: "structural",
  symbols: "structural",
  imports: "structural",
  calls: "universal",
  controlFlow: "universal",
  dataFlow: "universal",
  cpg: "structural",
  tests: "universal"
};
const def = (
  id: string,
  label: string,
  extensions: string[],
  capabilities: LanguageCapabilities,
  parser: LanguageDefinition["parser"],
  families: string[] = []
): LanguageDefinition => ({
  id,
  label,
  extensions,
  capabilities,
  parser,
  families,
  frontend: frontendFor(id, parser),
  conformance:
    parser === "typescript"
      ? "compiler-backed"
      : parser === "deterministic-adapter"
        ? "deterministic-grammar"
        : "structural-artifact",
  baseline:
    parser === "typescript"
      ? "compiler"
      : parser === "deterministic-adapter"
        ? "deterministic-structural"
        : "structural-artifact",
  semanticEnrichment: parser === "typescript" ? "built-in" : "vscode-language-service"
});
function frontendFor(
  id: string,
  parser: LanguageDefinition["parser"]
): LanguageDefinition["frontend"] {
  if (parser === "typescript") return "typescript-compiler";
  if (["python", "ruby", "r", "julia", "lua"].includes(id)) return "indent-grammar";
  if (["elixir", "erlang", "haskell"].includes(id)) return "functional-grammar";
  if (["shell", "powershell", "perl"].includes(id)) return "shell-grammar";
  if (["sql", "graphql", "protobuf"].includes(id)) return "schema-grammar";
  if (["html", "xml", "markdown", "css"].includes(id)) return "markup-grammar";
  if (["json", "yaml", "toml"].includes(id)) return "data-grammar";
  if (["terraform", "dockerfile", "make", "cmake", "maven", "gradle", "kubernetes"].includes(id))
    return "infrastructure-grammar";
  if (parser === "artifact") return "data-grammar";
  return "brace-grammar";
}

export const LANGUAGE_DEFINITIONS: readonly LanguageDefinition[] = [
  def("typescript", "TypeScript", [".ts", ".tsx"], deep, "typescript", ["source", "web"]),
  def("javascript", "JavaScript", [".js", ".jsx", ".mjs", ".cjs"], deep, "typescript", [
    "source",
    "web"
  ]),
  def("python", "Python", [".py", ".pyi"], deterministic, "deterministic-adapter", ["source"]),
  def("java", "Java", [".java"], deterministic, "deterministic-adapter", ["source", "jvm"]),
  def("csharp", "C#", [".cs"], deterministic, "deterministic-adapter", ["source", "dotnet"]),
  def("vbnet", "VB.NET", [".vb"], deterministic, "deterministic-adapter", ["source", "dotnet"]),
  def("go", "Go", [".go"], deterministic, "deterministic-adapter", ["source"]),
  def("rust", "Rust", [".rs"], deterministic, "deterministic-adapter", ["source"]),
  def("kotlin", "Kotlin", [".kt", ".kts"], deterministic, "deterministic-adapter", [
    "source",
    "jvm"
  ]),
  def("c", "C", [".c", ".h"], deterministic, "deterministic-adapter", ["source", "native"]),
  def(
    "cpp",
    "C++",
    [".cc", ".cpp", ".cxx", ".hpp", ".hh"],
    deterministic,
    "deterministic-adapter",
    ["source", "native"]
  ),
  def("php", "PHP", [".php"], deterministic, "deterministic-adapter", ["source", "web"]),
  def("ruby", "Ruby", [".rb"], deterministic, "deterministic-adapter", ["source"]),
  def("swift", "Swift", [".swift"], deterministic, "deterministic-adapter", ["source", "apple"]),
  def("scala", "Scala", [".scala"], deterministic, "deterministic-adapter", ["source", "jvm"]),
  def("dart", "Dart", [".dart"], deterministic, "deterministic-adapter", ["source"]),
  def("objective-c", "Objective-C", [".m", ".mm"], deterministic, "deterministic-adapter", [
    "source",
    "apple",
    "native"
  ]),
  def("lua", "Lua", [".lua"], deterministic, "deterministic-adapter", ["source"]),
  def("groovy", "Groovy", [".groovy"], deterministic, "deterministic-adapter", ["source", "jvm"]),
  def("elixir", "Elixir", [".ex", ".exs"], deterministic, "deterministic-adapter", [
    "source",
    "beam"
  ]),
  def("erlang", "Erlang", [".erl", ".hrl"], deterministic, "deterministic-adapter", [
    "source",
    "beam"
  ]),
  def("haskell", "Haskell", [".hs"], deterministic, "deterministic-adapter", [
    "source",
    "functional"
  ]),
  def("r", "R", [".r", ".R"], deterministic, "deterministic-adapter", ["source", "data"]),
  def("julia", "Julia", [".jl"], deterministic, "deterministic-adapter", ["source", "data"]),
  def("perl", "Perl", [".pl", ".pm"], deterministic, "deterministic-adapter", ["source"]),
  def("shell", "Shell", [".sh", ".bash", ".zsh"], deterministic, "deterministic-adapter", [
    "source",
    "automation"
  ]),
  def("powershell", "PowerShell", [".ps1", ".psm1"], deterministic, "deterministic-adapter", [
    "source",
    "automation"
  ]),
  def("sql", "SQL", [".sql"], deterministic, "deterministic-adapter", ["schema", "data"]),
  def("graphql", "GraphQL", [".graphql", ".gql"], deterministic, "deterministic-adapter", [
    "schema",
    "api"
  ]),
  def("protobuf", "Protocol Buffers", [".proto"], deterministic, "deterministic-adapter", [
    "schema",
    "api"
  ]),
  def("html", "HTML", [".html", ".htm"], structural, "artifact", ["web", "markup"]),
  def("css", "CSS", [".css", ".scss", ".sass", ".less"], structural, "artifact", ["web", "style"]),
  def("json", "JSON", [".json"], structural, "artifact", ["data", "config"]),
  def("yaml", "YAML", [".yaml", ".yml"], structural, "artifact", ["data", "config"]),
  def("toml", "TOML", [".toml"], structural, "artifact", ["data", "config"]),
  def("xml", "XML", [".xml"], structural, "artifact", ["data", "config"]),
  def("markdown", "Markdown", [".md", ".mdx"], structural, "artifact", ["docs"]),
  def(
    "terraform",
    "Terraform/HCL",
    [".tf", ".tfvars", ".hcl"],
    deterministic,
    "deterministic-adapter",
    ["infrastructure"]
  ),
  def("dockerfile", "Dockerfile", [], deterministic, "deterministic-adapter", ["infrastructure"]),
  def("make", "Make/Just", [], deterministic, "deterministic-adapter", ["build"]),
  def("cmake", "CMake", [], deterministic, "deterministic-adapter", ["build"]),
  def("maven", "Maven", [], structural, "artifact", ["build", "jvm"]),
  def("gradle", "Gradle", [], deterministic, "deterministic-adapter", ["build", "jvm"]),
  def("kubernetes", "Kubernetes/Helm", [], structural, "artifact", ["infrastructure"])
];

export const UNIVERSAL_TEXT_DEFINITION: LanguageDefinition = {
  id: "unknown",
  label: "Universal Text Artifact",
  extensions: [],
  capabilities: artifact,
  parser: "artifact",
  frontend: "universal-text-grammar",
  families: ["text"],
  conformance: "structural-artifact",
  baseline: "universal-text",
  semanticEnrichment: "vscode-language-service"
};

export class LanguageCapabilityRegistry {
  private readonly byExtension = new Map<string, LanguageDefinition>();
  constructor(private readonly definitions: readonly LanguageDefinition[] = LANGUAGE_DEFINITIONS) {
    for (const definition of definitions)
      for (const extension of definition.extensions)
        this.byExtension.set(extension.toLowerCase(), definition);
  }
  identify(fileName: string): LanguageDefinition | undefined {
    const lower = fileName.toLowerCase();
    const base = lower.split("/").pop() ?? lower;
    if (
      /(?:^|\/)(?:charts?|helm|k8s|kubernetes)(?:\/|$)/.test(lower) ||
      base === "chart.yaml" ||
      base === "values.yaml"
    )
      return this.definitions.find((x) => x.id === "kubernetes");
    if (base === "dockerfile" || base.startsWith("dockerfile."))
      return this.definitions.find((x) => x.id === "dockerfile");
    if (base === "makefile" || base === "justfile")
      return this.definitions.find((x) => x.id === "make");
    if (base === "cmakelists.txt") return this.definitions.find((x) => x.id === "cmake");
    if (base === "pom.xml") return this.definitions.find((x) => x.id === "maven");
    if (/^(build|settings)\.gradle(\.kts)?$/.test(base))
      return this.definitions.find((x) => x.id === "gradle");
    const extension = [...this.byExtension.keys()]
      .sort((a, b) => b.length - a.length)
      .find((item) => lower.endsWith(item));
    return extension ? this.byExtension.get(extension) : undefined;
  }
  all(): readonly LanguageDefinition[] {
    return this.definitions;
  }
  summary() {
    return this.definitions.map((item) => ({
      id: item.id,
      label: item.label,
      level: item.capabilities.parsing,
      extensions: item.extensions,
      parser: item.parser,
      conformance: item.conformance,
      baseline: item.baseline,
      semanticEnrichment: item.semanticEnrichment,
      frontend: item.frontend,
      capabilities: item.capabilities
    }));
  }
}
export const UNIVERSAL_LANGUAGE_CAPABILITIES = artifact;
