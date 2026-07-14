# Keystone

Keystone is a VS Code extension that turns developer intent into visible, repository-aware, specification-driven work delegated to GitHub Copilot.

The project is being implemented progressively from the approved specification in the `docs/` directory.

## Current implementation

Foundation Phase 1:

- single VS Code extension package;
- lazy Activity Bar Webview activation;
- React/Vite control-center shell;
- typed, runtime-validated Webview bridge;
- versioned workspace persistence and recovery;
- structured redacted logging and errors;
- configuration baseline and foundation tests.

Repository intelligence begins in Phase 2. Unimplemented capabilities are labeled as unavailable in the UI; Keystone does not mock Copilot or task-completion behavior.

## Development

```sh
npm install
npm run verify
```

Use the VS Code Extension Development Host to run the extension. The `Keystone: Open Control Center` command focuses the Activity Bar view.
