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

## Universal Deterministic Frontend

The universal deterministic frontend is the core of Keystone's language support. It provides a consistent, deterministic approach to analyzing any text-based artifact, regardless of its language or format. The frontend operates in three phases:

1. **Discovery**: Identifies all probable text files in the repository using filename patterns, MIME type detection, and content analysis
2. **Classification**: Determines the language or format of each file using a combination of heuristics and statistical analysis
3. **Extraction**: Extracts structural information from the file using language-specific grammars and parsers

The frontend is designed to be:

- **Deterministic**: Same input always produces same output
- **Unbounded**: No limits on file size or repository size
- **Extensible**: Easy to add new languages and formats
- **Robust**: Handles malformed or incomplete files gracefully
- **Efficient**: Minimizes processing time through intelligent caching

## Unknown Language Handling

Keystone can handle unknown or custom languages through its universal deterministic frontend. When a file with an unknown extension is encountered:

1. The file is identified as a probable text file based on content analysis
2. A generic text parser extracts basic structural information:
   - Lines and line endings
   - Indentation patterns
   - Token boundaries (whitespace, punctuation)
   - Structural patterns (braces, brackets, indentation levels)
   - Comment patterns
3. The file is assigned a "unknown" language classification
4. The file receives a basic OKF representation with:
   - File identity and metadata
   - Content and structural hashes
   - Structural entities (lines, blocks, statements)
   - Dependency signals (imports, includes)
   - Evidence and provenance
5. The file is included in the knowledge graph with basic relationships

This approach allows Keystone to provide intelligence on any text file, even those from proprietary or custom languages. The system will automatically improve its understanding of unknown languages over time as more files are analyzed.

## Semantic Enrichment

TypeScript and JavaScript currently receive compiler-backed semantic enrichment. For non-artifact registered languages, Keystone also asks the active VS Code language service for document symbols and available definition, reference, implementation, and call-hierarchy evidence. A missing or unavailable provider falls back to deterministic-structural analysis; it is never reported as semantic success. Language-service queries are bounded to 96 symbols per document and record an explicit warning when that boundary truncates enrichment.

1. **Language Service Integration**: Future providers may integrate installed VS Code language extensions through the same canonical binding contract
2. **Semantic Extraction**: Extracts additional semantic information from language services:
   - Definitions and declarations
   - References and usages
   - Implementations
   - Call hierarchies
   - Type information
   - Symbol relationships
3. **Semantic Binding**: The extracted semantic information is bound to the canonical OKF entities
4. **Enriched Projections**: The enriched semantic information is used to enhance graph, CPG, and search projections

When semantic enrichment is available:

- The UI reports the actual provider and semantic-enriched status for the language
- The language support level is marked as "compiler-backed" or "semantic"
- More detailed information is available in the intelligence UI
- CPGs include semantic relationships

When semantic enrichment is not available:

- The language support level is marked as "deterministic-structural"
- Basic structural information is used for projections
- All functionality remains available, just with less detailed information

The system logs which language services are used and any failures, providing transparency into the intelligence generation process.

## Language Detection Algorithm

Keystone uses a multi-stage language detection algorithm:

1. **Extension-Based Detection**: Uses file extension to identify known languages
2. **Content-Based Detection**: Analyzes file content for language-specific patterns
   - First line shebangs (e.g., #!/usr/bin/env python)
   - Language-specific keywords and syntax patterns
   - File structure and indentation patterns
   - Character encoding and line ending patterns
3. **Heuristic-Based Detection**: Uses heuristics based on file location and naming conventions
   - Configuration files (e.g., package.json, .gitignore)
   - Build files (e.g., Makefile, pom.xml)
   - Test files (e.g., _.test.js, Test_.java)
   - Documentation files (e.g., README.md, *.md)
4. **Fallback Classification**: Unknown probable-text files are assigned to the universal frontend when extension and filename rules do not identify a registered language.

The detection algorithm is designed to be:

- **Fast**: Returns results in milliseconds
- **Predictable**: Registered-language decisions are rule-based and inspectable
- **Extensible**: Easy to add new detection rules
- **Resilient**: Works with malformed or incomplete files
- **Transparent**: Logs detection decisions and confidence scores

The system maintains a database of language detection rules for 44 known languages and artifacts and can be extended with custom rules.

## Explicit Conformance Categories

Keystone registers and executes fixtures for 44 categories:

- Programming: TypeScript, JavaScript, Python, Java, C#, Go, Rust, Kotlin, C, C++, PHP, Ruby, Swift, Scala, Dart, Objective-C, Lua, Groovy, Elixir, Erlang, Haskell, R, Julia, Perl, Shell, PowerShell.
- Schemas/data/contracts: SQL, GraphQL, Protocol Buffers, JSON, YAML, TOML, XML.
- Web/docs: HTML, CSS/SCSS/Less, Markdown/MDX.
- Build/infrastructure: Terraform/HCL, Dockerfile, Make/Just, CMake, Maven, Gradle, Kubernetes/Helm.

## Semantic Depth

- TypeScript and JavaScript use the TypeScript compiler frontend for AST, symbol binding, configured project resolution, calls, inheritance, and compiler-backed CPG construction.
- Every other registered category uses a deterministic structural frontend and structural CPG.
- Active VS Code language services merge their available document symbols, definitions, references, implementations, and call hierarchy into the same canonical intelligence model. Their output remains session-bound until a provider can supply a stable persistence fingerprint.
- Until then, deterministic intelligence remains available and the UI records the measured structural/semantic provider rather than dropping the file.

## Framework Recognition

Framework recognition is deterministic evidence extraction, not a claim of compiler-level framework semantics. Keystone currently recognizes source or manifest signals for:

- TypeScript/JavaScript: NestJS, Express, Fastify, Next.js, React, Vue, Angular, Svelte, React Native, TypeORM, Prisma.
- Java/Kotlin: Spring, Quarkus, Ktor, Hibernate.
- C#/VB.NET: ASP.NET, Entity Framework.
- Python: FastAPI, Flask, Django, SQLAlchemy.
- Go: Gin, GORM.
- Rust: Axum, Actix Web, SQLx.
- PHP/Ruby/Elixir: Laravel, Symfony, Rails, Phoenix.
- Dart: Flutter.
- Cross-language infrastructure/contracts: Kafka, RabbitMQ, GraphQL, gRPC.

For these ecosystems, the model can surface bounded framework, route, middleware, component, persistence, or messaging signals supported by the detected evidence. Direct FastAPI/Flask decorators, Spring mapping annotations, named ASP.NET minimal-API mappings, Ktor route blocks, and Actix Web attributes create source-located route/handler facts for their supported forms. Prisma, TypeORM, Entity Framework, SQLAlchemy, Django ORM, GORM, Eloquent, Active Record, Sequelize, Mongoose, Drizzle, Knex, SQLx typed queries, and direct JPA `EntityManager` operations produce deterministic query facts with read/write relationships when a model target is explicit; links resolve across files only when a matching extracted table is available. Cross-file framework resolution, runtime reflection, dependency-injection resolution beyond the supported forms, and source-to-sink flow remain semantic-provider work rather than guaranteed deterministic output.

## Capability Reporting

The Intelligence UI reports, per language:

- indexed file count
- deterministic versus compiler baseline
- semantic provider used
- semantic-enriched file count
- failed semantic-enrichment count
- symbols, definitions, references, implementations, calls, control-flow, data-flow, and CPG availability
- warnings and provenance

The conformance suite also indexes every category plus an unknown future-language fixture through OKF and CPG end to end.

## Remaining Language-Support Work

The relevant active roadmap items are recorded in [GAP_ANALYSIS.md](./GAP_ANALYSIS.md) and [IMPLEMENTATION_PLANS.md](./IMPLEMENTATION_PLANS.md):

| Active gap | Impact on language support | Current direction |
| --- | --- | --- |
| P0-2 canonical entities and P1-2 polyglot semantic depth | TypeScript/JavaScript are compiler-backed; other languages use honest deterministic structural adapters. | Add language-service adapters and framework-specific semantic providers where a deterministic provider is unavailable. |
| P0-3 security/performance depth | Pattern-led findings can carry scoped API, call, persistence, and dependency context, but are not proven data-flow results. | Add source-to-sink, authorization-boundary, call-path, runtime, and benchmark evidence. |
| P0-4 large intelligence navigation | Explorer cursor pagination, viewport virtualization, and progressive graph/CPG segments protect the UI. | Preserve scale behavior and add only evidence-backed navigation enhancements. |
| P1-1 persistent caching | Extraction, TypeScript/JavaScript compiler-semantic, query, graph, and context caches are persistent and retained; VS Code language-service output is session-bound. | Persist an additional provider only when it supplies a stable provider/configuration fingerprint. |
