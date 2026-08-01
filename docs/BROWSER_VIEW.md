# Open Keystone in Browser

**Open Keystone in Browser** renders the same Keystone application outside the VS Code panel. It is not a clone, second workspace, or second runtime.

## Same-instance design

- One extension host
- One application store
- One workspace identity
- One intelligence snapshot
- One SDLC engine
- One Task Handoff state
- One command path

The VS Code webview uses the VS Code message transport. The browser uses an authenticated loopback HTTP/SSE transport. Both receive the same versioned state snapshots.

## Security

- binds only to `127.0.0.1`
- random operating-system-assigned port
- one-time, short-lived bootstrap token
- HttpOnly, SameSite=Strict session cookie
- restrictive Content Security Policy
- same-origin command requirement
- explicit command allowlist
- JSON body and size validation
- stale-state rejection using expected state version
- shutdown on extension disposal
- remote workspace URL resolution through VS Code external-URI handling

Tests cover unauthorized access, bootstrap replay, CSP, cross-origin rejection, unknown commands, stale state, accepted command dispatch, reconnect, and live state updates.
