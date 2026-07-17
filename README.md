# Keystone

Keystone is a VS Code extension that builds deterministic repository intelligence, converts developer intent into approved specifications and task plans, constructs token-efficient context, delegates approved implementation tasks to GitHub Copilot, validates results, supports QA/security/performance checks, prepares Git and PR delivery, and enables Task Handoff.

The project is being implemented progressively from the approved specification in the `docs/` directory.

## Current implementation

Keystone remains one VS Code extension package with a React/Vite Webview, extension-managed local persistence, deterministic repository Intelligence/semantic graph/CPG/query services, intent/specification/task workflows, bounded context construction, capability-driven Copilot delegation, execution and validation tracking, Git/PR delivery, and portable Task Handoff.

There is no backend, external database, centralized intelligence service, or active local-model/training runtime. Future ideas are separated in [the roadmap](docs/10-future-roadmap.md) and do not affect current builds or release gates.

## Development

```sh
npm install
npm run verify
```

Use the VS Code Extension Development Host to run the extension. The `Keystone: Open Control Center` command focuses the Activity Bar view.
