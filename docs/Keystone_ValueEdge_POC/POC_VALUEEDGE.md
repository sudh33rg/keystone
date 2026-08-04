# ValueEdge POC Contract

## Question being proved

Can repository intelligence improve ValueEdge backlog generation by grounding proposed User Stories and Quality Stories in the code, architecture, persistence surfaces, APIs, UI surfaces, and existing tests that already exist in the repository?

## Runtime contract

The active POC runtime is limited to:

`Local Repository → Intelligence → ValueEdge Feature → Evidence Matching → User/Quality Stories → Review → ValueEdge REST`

ValueEdge is the only external service used by this POC.

## Story evidence contract

Every generated story must carry at least one concrete repository evidence record. Evidence includes an entity type, qualified name, repository-relative path, confidence, and the feature term that produced the match where available.

User Stories should split meaningful implementation concerns when the repository supports them, including API/service, persistence/data model, and UI integration surfaces.

Quality Stories should prefer extending existing tests when test assets are discovered and should name those tests explicitly. Quality acceptance criteria should include positive, negative, boundary, and regression coverage where appropriate.

## Publish contract

Nothing is published automatically. The webview provides explicit publish actions after review. Published entities are drafts whose parent is the selected ValueEdge Feature.

## Configuration contract

Real URL, shared-space ID, workspace ID, and Authorization values are intentionally placeholders and are supplied through VS Code settings.
