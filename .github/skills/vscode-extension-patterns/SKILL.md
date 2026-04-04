---
name: vscode-extension-patterns
description: VS Code extension lifecycle and architecture patterns for activation events, command registration, disposables, and resilient API usage in TypeScript extensions.
---

# VS Code Extension Patterns

## Domain
VS Code extension implementation patterns for maintainable command-based extensions.

## When to Use This Skill
- Adding or refactoring extension activation logic.
- Registering commands, providers, or status bar items.
- Auditing disposable cleanup and extension shutdown safety.

## Methodology
1. Activation Design
- Keep activation lightweight and defer costly work.
- Register commands/providers in a single activation flow.
- Push all disposables to `context.subscriptions`.

2. Command Patterns
- Keep commands thin and delegate heavy logic to modules.
- Use clear command IDs and user-facing titles.
- Guard commands with meaningful error messages.

3. Disposable Management
- Dispose status bar items, event listeners, and timers.
- Avoid orphaned resources across reloads.

4. Error Handling
- Surface actionable errors with next steps.
- Avoid silent catches unless telemetry captures detail.

## Success Criteria
- [ ] Activation remains fast and deterministic.
- [ ] Every registration has explicit disposal.
- [ ] Command behavior is testable and predictable.
