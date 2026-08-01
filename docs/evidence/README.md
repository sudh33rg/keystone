# Execution Evidence

This folder is generated from the executable Keystone acceptance flow.

- `runtime-results.json` — machine-readable runtime acceptance counts.
- `npm-verify.log` — complete output from the final `npm run verify` execution.
- `clean-room-verify.log` — output from unpacking the delivered ZIP, installing from the bundled offline lockfile, and running the full verification pipeline.
- `demo-state.json` — evidence-backed application state used only to render the production-built React UI for screenshots.
- `screenshots/01-home.png` — Browser View home and evidence surface.
- `screenshots/02-intelligence.png` — language capability, OKF, graph/CPG, and provenance surface.
- `screenshots/03-work.png` — repository R&D, dynamic backlog, SDLC, Copilot delegation, and Task Handoff surface.
- `screenshots/04-activity.png` — visible non-blocking operations.
- `screenshots/05-vscode-webview.png` — the same built React application rendered through the VS Code transport mode.

The UI screenshots are captured from `dist/media`, the same production build packaged in the VSIX. The Browser View transport itself is independently exercised by the runtime and unit acceptance scenarios covering authentication, origin enforcement, stale-state rejection, reconnect, and shared state.
