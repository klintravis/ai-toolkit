---
applyTo: src/**/*.ts
description: VS Code extension development rules for activation, command registration, disposables, and resilient API usage.
---

# Extension Development Instructions

## Context Overview
AI Toolkit is a TypeScript VS Code extension that discovers external Copilot assets and renders toolkit state in a sidebar. Core flow is scanner -> tree provider -> extension command orchestration.

## Constraints
- Target runtime: VS Code extension host.
- Language: TypeScript strict mode.
- Prefer non-blocking APIs on extension host threads.

## Coding Standards
- Activation must stay lightweight and deterministic.
- Register commands/providers in `activate` and push disposables to `context.subscriptions`.
- Keep command handlers thin; move logic into focused helpers/modules.
- Avoid synchronous file I/O in active command or refresh paths.
- Surface errors to users with actionable text; avoid silent catches.
- Use descriptive names over generic helper abstractions.

## Testing Strategy
- Add unit tests for behavior changes in scanner/settings/tree logic.
- Cover async success and failure paths.
- Verify command paths with mocked VS Code APIs.

## Documentation Requirements
- Update command/config docs when contributions change.
- Document any new error state surfaced in tree/status UI.

## Acceptance Criteria
- Behavior change is covered by tests or explicit test plan.
- No new disposable leaks.
- No blocking file operations introduced in hot paths.

## Examples
- Good: command validates input, delegates to scanner service, refreshes tree.
- Bad: command directly performs scan, settings mutation, and UI rendering in one function.
