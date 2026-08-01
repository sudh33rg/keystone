# ValueEdge Feature and Story Integration

Keystone can start an intent-led SDLC from an existing ValueEdge feature and publish the approved small backlog under that feature.

## Import

1. Configure tenant base URL, shared-space ID, workspace ID, and API client ID in workspace settings.
2. Store the API client secret in VS Code SecretStorage. It is never written under `.keystone`, included in Browser View state, or added to Task Handoff.
3. Enter a ValueEdge feature ID and choose **Import Feature**.
4. Keystone reads the feature, creates the local intent, and performs deterministic repository R&D before planning.

## Planning

The approved local plan contains:

- a presentable R&D document
- small user stories derived from affected APIs, services, data entities, symbols, and repository slices
- quality stories derived from mapped/missing tests, security and performance risk, engineering review, and read-only PR review
- the full 16-story executable SDLC state machine

The local SDLC and its evidence remain authoritative while work is in progress.

## Publication

After explicit specification approval, generated backlog stories become approved. The user must confirm publication. Keystone then creates draft user and quality stories under the imported feature and records returned external IDs. It does not update unrelated ValueEdge entities or publish unapproved stories.
