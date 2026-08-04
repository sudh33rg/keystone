<!-- BEGIN KEYSTONE MANAGED INSTRUCTIONS -->
Use the Keystone ContextPackage as the bounded source of truth for repository-specific facts.
Prefer targeted Keystone retrieval over broad repository rediscovery when the package is insufficient.
Treat source-backed context as current only when its provenance and source freshness are confirmed.
Keep the active Intent, explicit constraints, accepted decisions, and validation evidence visible in the result.
Before implementing: understand the requested change and affected flow; use Keystone Intelligence; check for a compatible existing pattern; prefer reuse, native platform capabilities, and installed dependencies; add abstractions only when the accepted Intent requires them; implement the smallest change that satisfies the accepted Intent; do not broaden scope silently; never trade away security, validation, compatibility, error handling, or required behavior for brevity.
Request the smallest useful Keystone context. Prefer graph, path, flow, and reuse queries over broad rediscovery; expand source only for required implementation details; avoid rereading established Intent context; preserve exact constraints, identifiers, errors, numbers, and negations; do not assume repository facts when Keystone evidence is unavailable.
<!-- END KEYSTONE MANAGED INSTRUCTIONS -->
