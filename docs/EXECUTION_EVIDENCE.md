# Keystone Execution Evidence

The final acceptance pipeline is:

```bash
npm ci --offline --ignore-scripts
npm run verify
```

The pipeline performs product-boundary validation, strict core/extension/webview type checking, active-source linting, the real Node test suite, runtime acceptance scenarios, production build, VSIX packaging, and VSIX archive verification.

## Runtime acceptance

The machine-readable evidence is stored in [`evidence/runtime-results.json`](evidence/runtime-results.json). The scenario verifies:

- the actual Keystone repository is ingested and produces files, symbols, and language evidence;
- 43 registered language/artifact frontends and one unknown future-language extension run end to end;
- every fixture produces OKF and CPG artifacts;
- all 17 OKF knowledge kinds and 16 relationship kinds are produced and semantically validated;
- the portable OKF v0.2 Markdown/YAML bundle validates, declares its version, and carries generated/verified/source/footnote provenance;
- unchanged intelligence is reused and deletion creates tombstones with stale historical evidence;
- 5,205 files are discovered and indexed without a file cap;
- repository evidence produces dynamic user and quality stories;
- all 16 SDLC stages complete only through dependencies, approvals, explicit criteria, evidence, validation, and review;
- ValueEdge import and approved story publication use the integration boundary;
- Task Handoff encryption/decryption preserves the exact SDLC plan;
- Browser View authentication, replay prevention, same-origin commands, stale-state rejection, reconnect, and one shared state are enforced;
- Git remains read-only.

## UI evidence

The screenshots in [`evidence/screenshots`](evidence/screenshots/) are captured from the production-built React files in `dist/media`.

| Surface | Screenshot |
|---|---|
| Browser View home | `01-home.png` |
| Intelligence and language/OKF evidence | `02-intelligence.png` |
| Intent R&D, backlog, SDLC, delegation and Task Handoff | `03-work.png` |
| Non-blocking activity | `04-activity.png` |
| Same React application in VS Code transport mode | `05-vscode-webview.png` |

No screenshot is a design mock. Each is rendered by the built application with a recorded application-state fixture created from the same runtime acceptance data.
