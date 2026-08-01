# Language and Artifact Support

## Complete support contract

Keystone does not require a repository to use a known extension. Every probable text file that is outside an explicitly ignored generated, dependency, cache, or VCS directory is discovered and represented. Unknown/custom languages use the universal deterministic frontend and receive:

- file and artifact identity
- content and structural hashes
- evidence and provenance
- structural entities where recognizable
- dependency/import signals
- call, branch, assignment, and data-flow signals where recognizable
- test and API signals where recognizable
- OKF representation
- graph/search projection
- per-artifact structural CPG
- incremental reuse and deletion lifecycle

## Explicit conformance categories

Keystone registers and executes fixtures for 43 categories:

- Programming: TypeScript, JavaScript, Python, Java, C#, Go, Rust, Kotlin, C, C++, PHP, Ruby, Swift, Scala, Dart, Objective-C, Lua, Groovy, Elixir, Erlang, Haskell, R, Julia, Perl, Shell, PowerShell.
- Schemas/data/contracts: SQL, GraphQL, Protocol Buffers, JSON, YAML, TOML, XML.
- Web/docs: HTML, CSS/SCSS/Less, Markdown/MDX.
- Build/infrastructure: Terraform/HCL, Dockerfile, Make/Just, CMake, Maven, Gradle, Kubernetes/Helm.

## Semantic depth

- TypeScript and JavaScript use the TypeScript compiler frontend for AST, symbol binding, configured project resolution, calls, inheritance, and compiler-backed CPG construction.
- Every other registered category uses a deterministic structural frontend and structural CPG.
- When a VS Code language extension supplies document symbols, definitions, references, implementations, or call hierarchy, Keystone merges that semantic evidence into the same canonical intelligence model.
- If a language service is absent or fails, deterministic intelligence remains available and the UI records the measured provider and warning rather than dropping the file.

## Capability reporting

The Intelligence UI reports, per language:

- indexed file count
- deterministic versus compiler baseline
- semantic provider used
- semantic-enriched file count
- failed semantic-enrichment count
- symbols, definitions, references, implementations, calls, control-flow, data-flow, and CPG availability
- warnings and provenance

The conformance suite also indexes every category plus an unknown future-language fixture through OKF and CPG end to end.
