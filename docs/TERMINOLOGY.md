# Keystone Terminology

This document defines the canonical terms used throughout the Keystone UI,
documentation, and user-facing messages. Use exactly one term per concept.

## Canonical terms

| Term | Definition |
|------|------------|
| **Workflow** | A single spec-driven development effort (feature, bug fix, refactor, etc.) tracked from intent to completion. |
| **Work item** | A unit of work within a workflow (a task, stage entry, or requirement). |
| **Stage** | A step in the SDLC journey (Development, Impact Analysis, QA, Security, Performance, PR Review, Change Readiness). |
| **Repository Intelligence** | The local, deterministic graph and evidence model built from the open repository. |
| **Context Package** | A bounded, token-efficient set of files, entities, and evidence assembled for a task. |
| **Execution Configuration** | The user-configured test/run profile used to execute and validate work. |
| **Source Scope** | The set of changed files and entities a workflow operates on. |
| **Impact Analysis** | Determination of which symbols, tests, and behaviours are affected by a change. |
| **QA Plan** | The test-selection and failure-classification plan for a change. |
| **QA Execution** | Running the selected tests and classifying results (pass/fail/flaky). |
| **Security Decision** | The evidence-backed determination of whether a change introduces security risk. |
| **Performance Decision** | The evidence-backed determination of whether a change affects performance. |
| **PR Review** | The evidence-backed pull-request review and change-readiness assessment. |
| **Change Readiness** | The consolidated go/no-go state across review, QA, security, and performance. |
| **Task Handoff** | A local, portable package that transfers an in-progress workflow to another workstation. |

## Competing labels removed from the UI

Do not expose these as primary labels:

- "session sharing" → use **Task Handoff**
- "delivery" → covered by **PR Review** / **Change Readiness**
- "orchestration instance" → internal only; UI shows **Workflow**
- "workbench" → internal only; UI shows **Active Work**
- "execution workspace" → use **Active Work**
- "task session" → use **Workflow**
- "intent record" → use **Workflow**
- "active task" (when it means workflow) → use **Workflow**

## Internal legacy type names

Some internal TypeScript type/identifier names predate this terminology
(`OrchestrationInstance`, `WorkbenchState`, `DeliveryRecord`, etc.). They are
permitted in code only where renaming would create migration risk. They must never
appear in the UI, user-facing strings, or documentation. Keep them internal.

## Status and stage labels

Use consistent, capitalized stage labels across all surfaces:

`Development · Impact Analysis · QA · Security · Performance · PR Review · Change Readiness`

Status values use a small fixed vocabulary: `not-started`, `in-progress`,
`blocked`, `passed`, `failed`, `cancelled`, `stale`. Do not invent ad-hoc
status words in the UI.
