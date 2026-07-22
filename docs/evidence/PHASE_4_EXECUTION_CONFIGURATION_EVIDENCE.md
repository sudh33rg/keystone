# Keystone Phase 4 Execution Configuration Evidence

Verified on 2026-07-22 in the real VS Code 1.95.0 Extension Development Host on macOS. This report covers only agent, skill, instruction, and execution-profile configuration inside the canonical Development stage.

## TDD and automated coverage

The Phase 4 service, UI, and protocol tests were written before the production implementation. The initial red run is recorded in [PHASE_4_TDD_BASELINE.md](PHASE_4_TDD_BASELINE.md). Final coverage includes capability honesty, instruction discovery and preview, skill validation, deterministic conflicts, authoritative profile persistence, prompt invalidation/integration, manual-agent separation, UI state, and strict host messages.

Final Phase 4 verification:

```text
npm test
Test Files  89 passed (89)
Tests       655 passed (655)

Phase 4 targeted ESLint
0 errors, 0 warnings

npm run build
passed

npm run test:extension
VS Code 1.95.0 Extension Development Host exited 0

npx vsce package --allow-missing-repository --no-dependencies --baseContentUrl . --baseImagesUrl .
Packaged keystone-0.1.0.vsix (23 files, 2.27 MB)
SHA-256 6daa44206ba71c51626f2fd5279263607728ca369d56007b2dc1b23a652ed196
```

Repository-wide `npm run typecheck` is presently blocked by concurrent, untracked Tree-sitter extraction work outside Phase 4: missing `RustExtractor`, `JavaExtractor`, and `TypeScriptExtractor` modules plus strict string errors in `GoExtractor.ts:110` and `PythonExtractor.ts:127`. Those files were preserved untouched. The Phase 4 build, tests, targeted lint, Extension Host test, and VSIX packaging pass.

## Real implementation

- `ExecutionCapabilityDiscoveryService` inspects the VS Code clipboard and registered commands, maintains an explicit session cache, and reports direct invocation as unavailable with an exact diagnostic. It does not invent agents or capabilities.
- `InstructionDiscoveryService` reads real bounded Markdown/text instruction files, excludes generated/vendor trees, records URI/path/hash/size/mtime, and preserves missing/unreadable/unsupported states.
- `DevelopmentSkillService` supplies one persisted, versioned Development skill with a stable content hash and bounded required output.
- `InstructionConflictDetector` compares actual selected instruction contents and emits source paths, evidence, confidence, severity, and a deterministic resolution path.
- `ExecutionConfigurationService` persists manual agents, manual instruction paths, skill definitions, and authoritative workflow/work-item profiles in `.keystone/workflows/phase-4-execution-configuration.json`. It refreshes availability/hashes, marks profiles stale, preserves paths for missing configured instructions, blocks invalid saves, and invalidates prepared prompts after a profile change.
- `DevelopmentPromptService` includes the selected profile identity/hash, real skill fragment, actual instruction contents and paths, source scope, execution note, constraints, and required result structure.
- `ExecutionConfiguration` is embedded only in canonical Development. Existing discovered/manual agents and Development skills use grouped dropdown selectors; it also supports previews, conflict feedback, manual-agent create/edit/delete, validation, save/reset, and stale refresh.
- The typed webview boundary validates every Phase 4 request and result. No generic unvalidated payload path was added.

## Real Extension Development Host scenarios

A clean Git fixture under `/tmp/keystone-phase4-host.qLtLnD` contained a real source file and two real repository instructions. The workflow and all `.keystone` records were created by the running extension UI.

| Scenario | Verified behavior |
| --- | --- |
| A — capability discovery | Clipboard Handoff, Supported Chat Command, and Manual Work were available from real host state. Direct Invocation was disabled with `No supported direct agent invocation API is available to Keystone.` No fake agent appeared. |
| B — manual agent | `Local Review Agent` persisted separately with `missing.local.review · not registered` and the explicit manual-agent warning. Create was exercised in-host; edit/delete are covered by the live UI contract and tests. |
| C — instruction discovery | `.github/copilot-instructions.md` and `.github/instructions/conflicting.instructions.md` were discovered with real paths, sizes, availability, and SHA-256 hashes. |
| D — instruction preview | The UI displayed the actual file content together with path, hash, byte count, and modification time. Unsupported and missing behavior is covered by real-filesystem tests. |
| E — Development skill | The single Development skill showed source, version, hash, description, and the actual prompt fragment preview. |
| F — conflicts | Selecting `Always run tests` and `Do not run tests` sources produced a blocking inferred `test-requirement` conflict with both real paths and evidence. Deselecting the conflicting source cleared the block. |
| G — no configuration | Prompt context is rejected with `execution-profile-invalid` until a valid profile is saved; the UI keeps Prompt Preparation gated. |
| H — valid configuration | Clipboard Handoff + Development skill + one real instruction saved as `VALID`. The real source file was selected through VS Code's multi-select Quick Pick. |
| I — manual work | Manual Work is a truthful selectable mode and never claims agent invocation. The Phase 3 manual completion path remains available and external work stays outside Keystone. |
| J — refresh and persistence | Editing the selected instruction changed its size/hash; Refresh marked the saved profile `STALE` and blocked prompt reuse. A real `Developer: Reload Window` restored the source scope, manual agent, stale profile, and Home action `Review stale Development execution profile`. |

The integrated prepared prompt contained the real intent, objective, specification, `src/refund.ts` scope, Development skill fragment, selected instruction path and current contents, clipboard execution note, required result fields, and no-Git-mutation constraint.

## Screenshots

All screenshots were captured from the real Extension Development Host:

- [Capability discovery](screenshots/phase4/configuration-discovery-dark-host.png)
- [Manual agent and capability availability](screenshots/phase4/manual-agent-dark-host.png)
- [Skill and instruction previews](screenshots/phase4/skill-and-instruction-preview-dark-host.png)
- [Instruction conflict warning](screenshots/phase4/conflict-warning-dark-host.png)
- [Saved valid configuration](screenshots/phase4/saved-valid-configuration-dark-host.png)
- [Integrated prompt preview](screenshots/phase4/integrated-prompt-preview-dark-host.png)
- [Stale profile after refresh](screenshots/phase4/stale-after-refresh-dark-host.png)

## Boundaries

Phase 4 does not add direct agent invocation, fake progress, execution monitoring, context compression, token counting, Intelligence UI, Impact Analysis, QA, testing/healing, security, performance, PR review, cancellation, or Task Handoff. Supported chat capability is only reported from a real registered command; clipboard and manual paths do not imply external execution.
