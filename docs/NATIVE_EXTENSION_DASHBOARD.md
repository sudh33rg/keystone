# Native Extension Dashboard and Webview Launch

## Purpose

Keystone exposes one lightweight native Activity Bar dashboard and one singleton React Webview panel. The dashboard reports current canonical repository, intelligence, workflow, task, validation, finding, Handoff, and persistence state; it does not duplicate the full application.

## Architecture

- `KeystoneDashboardViewModelService` projects bounded tree sections from existing services and stores. Every item has a stable ID, tooltip, accessibility label, context value, and optional typed destination.
- `KeystoneDashboardProvider` renders those view models with VS Code `TreeItem` primitives. Commands receive only stable dashboard item IDs; destinations are resolved again at execution time.
- `KeystonePanelService` owns the sole `keystone.controlCenter` panel, its message receiver, and its message router. Repeated opens reveal the existing panel.
- `KeystoneLaunchValidationService` validates all typed destinations against current workspace, repository, workflow, task, finding, and entity state before navigation.
- `KeystoneNavigationService` is the single entry point for commands, dashboard actions, and Webview-originated navigation.
- `KeystonePanelStateService` persists safe shell metadata to `.keystone/state/native-shell.json`. It stores route and stable IDs, never repository source, prompts, evidence bodies, or credentials.
- `KeystoneDashboardRefreshService` coalesces runtime, workspace, and editor events. No polling loop is used.
- `KeystoneStatusBarService`, `KeystoneContextKeyService`, and `KeystoneNotificationService` derive their state from the same dashboard projection.

## Launch protocol

1. The extension validates a typed `OpenKeystoneRequest` and records it as pending.
2. A missing panel is created; an existing panel is revealed.
3. The Webview sends `keystone/webviewReady` with an instance ID and protocol version.
4. The Extension Host sends bounded initialization state and any pending validated navigation.
5. The Webview restores the route, acknowledges initialization, and acknowledges external navigation sequences.
6. The extension clears pending navigation only after the matching sequence is acknowledged.

Invalid or stale destinations produce an explicit recovery object and a safe fallback route. Keystone never silently opens an unrelated workflow, task, entity, finding, or repository.

## Commands and menus

The Command Palette provides meaningful product actions: open Keystone, start or resume work, open the current task, ask the repository, import a Task Handoff, and open diagnostics or settings. Editor context actions appear only for trusted workspaces with ready intelligence and resolve the entity at the active editor position before opening entity, usage, flow, or impact views.

The single status item reports Ready, Indexing, Task active, Action needed, or Validation failed. Clicking it opens the most relevant existing destination.

## Limits and safety

- Dashboard sections are capped by the typed contract; attention items are individually bounded.
- Tooltips and accessibility labels are plain bounded strings.
- Webview scripts use a per-render nonce and strict CSP; command URIs are disabled.
- Heavy intelligence and workflow operations remain in existing background services. Dashboard projection is metadata-only and measured.
- Workspace trust and current canonical IDs are revalidated at action time.
- Native shell persistence remains repository-local under `.keystone`; no backend or external database is introduced.

## Recovery behavior

Supported recovery cases include missing workspace, repository mismatch, removed workflow or task, missing entity or finding, and unavailable targets. Recovery preserves diagnostics and offers Home or Diagnostics rather than guessing a replacement target. Panel disposal, reload, move, and Extension Host restart keep only safe restoration metadata.
