# 14 — Current Limitations

This register records current limitations, not historical audit snapshots. Run
the verification commands before treating an entry as current.

| Area | Current boundary | Direction |
| --- | --- | --- |
| Language semantics | TypeScript and JavaScript are compiler-backed. Other non-artifact languages retain deterministic structural results and can use bounded evidence from an active VS Code language service. | Validate installed providers on representative workspaces before claiming cross-file semantic depth. |
| Security and performance | Explicit authorization and database-in-loop patterns are review findings with scoped evidence, not proof of authorization coverage or measured impact. | Add proven source-to-sink, runtime, and benchmark evidence. |
| UI acceptance | Source, protocol, and browser transport behavior are tested, but visual behavior needs a real VS Code/browser session. | Perform visual QA when changing interaction or rendering behavior. |
| Copilot acceptance | The `vscode.lm` contract and captured-result path are verified, but a live response requires user authorization. | Test in a signed-in VS Code session when changing delegation behavior. |
| Derived workspace state | `.keystone/` can be substantial in large repositories. | Use cache-maintenance commands and keep generated workspace state out of source control. |

## Resolved historical items

- The root README is now an end-user install and usage guide; development
  material lives under `docs/dev/`.
- Focused Node tests live under `tests/` and run with `npm test`.
- Cache-maintenance commands are contributed in `package.json` and available
  through the Command Palette.

## Verification

Run the following before changing this register:

```bash
npm test
npm run verify:source
npm run verify:cross-feature
npm run verify:production
```

See [Verification](12-verification.md) for what each gate proves.
