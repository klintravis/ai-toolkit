---
name: code-review
description: Review methodology for extension code quality with AI slop detection, VS Code specific antipattern checks, and practical refactoring guidance.
---

# Code Review

## Domain
Code review for TypeScript VS Code extensions with emphasis on readability, correctness, and maintainability.

## When to Use This Skill
- Reviewing feature changes before merge.
- Detecting AI slop in generated code.
- Refactoring noisy or over-abstracted modules.

## Methodology
1. Behavioral correctness first, style second.
2. Flag AI slop patterns:
- Over-engineering for simple flows.
- Verbose wrappers with no value.
- Generic names that hide intent.
- Unnecessary abstractions and indirection.
3. Check VS Code extension antipatterns:
- Forgotten disposables.
- Silent error swallowing.
- Blocking/sync filesystem operations.
- Command logic coupled to UI rendering internals.
4. Provide concrete fixes with file-local examples.

## Before/After Refactor Pattern
- Before: long command handler with mixed scanning, formatting, and UI mutation.
- After: thin command handler delegates to focused functions and returns typed result.

## Success Criteria
- [ ] Findings are prioritized by severity.
- [ ] Suggestions reduce complexity without changing behavior.
- [ ] Review guidance maps to concrete code edits.
