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

For languages with available VS Code language extensions, Keystone performs semantic enrichment:

1. **Language Service Integration**: Keystone detects and integrates with installed VS Code language extensions
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
- The UI shows "semantic-enriched" status for the language
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
   - Test files (e.g., *.test.js, Test*.java)
   - Documentation files (e.g., README.md, *.md)
4. **Machine Learning-Based Detection**: Uses lightweight statistical models trained on known language samples
   - Character n-gram analysis
   - Token frequency analysis
   - Structural pattern recognition

The detection algorithm is designed to be:
- **Fast**: Returns results in milliseconds
- **Accurate**: High precision and recall for common languages
- **Extensible**: Easy to add new detection rules
- **Resilient**: Works with malformed or incomplete files
- **Transparent**: Logs detection decisions and confidence scores

The system maintains a database of language detection rules for 43 known languages and can be extended with custom rules.

## Explicit Conformance Categories

Keystone registers and executes fixtures for 43 categories:

- Programming: TypeScript, JavaScript, Python, Java, C#, Go, Rust, Kotlin, C, C++, PHP, Ruby, Swift, Scala, Dart, Objective-C, Lua, Groovy, Elixir, Erlang, Haskell, R, Julia, Perl, Shell, PowerShell.
- Schemas/data/contracts: SQL, GraphQL, Protocol Buffers, JSON, YAML, TOML, XML.
- Web/docs: HTML, CSS/SCSS/Less, Markdown/MDX.
- Build/infrastructure: Terraform/HCL, Dockerfile, Make/Just, CMake, Maven, Gradle, Kubernetes/Helm.

## Semantic Depth

- TypeScript and JavaScript use the TypeScript compiler frontend for AST, symbol binding, configured project resolution, calls, inheritance, and compiler-backed CPG construction.
- Every other registered category uses a deterministic structural frontend and structural CPG.
- When a VS Code language extension supplies document symbols, definitions, references, implementations, or call hierarchy, Keystone merges that semantic evidence into the same canonical intelligence model.
- If a language service is absent or fails, deterministic intelligence remains available and the UI records the measured provider and warning rather than dropping the file.

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