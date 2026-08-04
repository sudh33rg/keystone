# Keystone ValueEdge POC

This repository is an intentionally small proof of concept for one Keystone hypothesis:

> **ValueEdge feature intent + local repository intelligence can produce more implementation-aware User Stories and Quality Stories than feature-description-only generation.**

This is not the full Keystone product. It contains only the local Intelligence Layer required by the proof, the ValueEdge REST integration, repository-aware story generation, and one focused VS Code webview for review/publish.

## POC flow

1. Open a local repository in VS Code.
2. Keystone builds/reconciles local repository intelligence under `.keystone-poc/`.
3. Enter a ValueEdge Feature ID.
4. The extension reads the Feature through the ValueEdge REST API.
5. Feature terms are matched against local repository intelligence.
6. User Stories and Quality Stories are generated with concrete repository evidence and acceptance criteria.
7. The user reviews the proposals.
8. Selected stories are published to ValueEdge as drafts beneath the source Feature.

## POC scope

Included:
- Local deterministic repository intelligence.
- Incremental repository indexing and query.
- ValueEdge Feature fetch through REST.
- Repository-aware User Story generation.
- Repository-aware Quality Story generation.
- Existing test discovery for quality stories.
- Explicit review before publish.
- Draft User Story and Quality Story publishing to ValueEdge.
- One lightweight HTML/CSS/JavaScript webview.

Not included:
- Any AI assistant or chat integration.
- SDLC workflow orchestration.
- Task handoff.
- Delivery/PR workflows.
- Context delegation/compression UI.
- Authentication infrastructure beyond the configured ValueEdge Authorization header.
- External intelligence storage.

## Configuration

Set these VS Code settings before connecting to a real ValueEdge workspace:

- `keystone.poc.valueEdge.baseUrl`
- `keystone.poc.valueEdge.sharedSpaceId`
- `keystone.poc.valueEdge.workspaceId`
- `keystone.poc.valueEdge.authorization`

Do not commit real credentials.

## Commands

- `Keystone POC: Open ValueEdge Story Generator`
- `Keystone POC: Generate ValueEdge Stories`
- `Keystone POC: Open ValueEdge Settings`
- `Keystone POC: Rebuild Repository Intelligence`

## Verification

The repository includes a deterministic executable proof using the existing full-stack intelligence fixture and a local mock ValueEdge REST service:

```bash
npm run verify:poc
```

Expected result:

```text
PASS: 4 user stories, 3 quality stories, 17 evidence records
```

The run verifies Feature fetch, repository evidence use, story quality assertions, test-aware Quality Stories, ValueEdge parent relationships, draft publishing, and authorization propagation.

Full extension verification in a normal development environment:

```bash
npm install
npm run verify
```

`package-lock.json` is intentionally not shipped with this POC so the cleaned dependency set can be resolved in the target development environment.

## Project shape

```text
src/
  core/intelligence/       local repository intelligence
  core/persistence/        local intelligence persistence
  extension/               minimal VS Code activation + POC panel
  poc/                     ValueEdge REST + story generation
  shared/                  intelligence contracts/logging/errors
  ui/                      single dependency-free POC webview
scripts/
  verify-valueedge-poc.mjs executable POC proof
  build-webview.mjs        copies dependency-free UI assets
  build-extension.mjs      extension bundling
  poc-evidence/            generated verification evidence
tests/
  fixtures/                deterministic intelligence fixture
```
