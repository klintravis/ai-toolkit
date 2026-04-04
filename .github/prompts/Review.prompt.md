---
description: Review AI Toolkit changes for correctness, regressions, and AI slop with VS Code extension specific checks.
argument-hint: review scope
agent: FeatureOrchestrator
---

# Review

Perform a focused code review with severity-ranked findings and test gap analysis.

---
**Scope** [REQUIRED]: ${input:scope:changed files, folder, or feature}
**Review Focus** [OPTIONAL]: ${input:focus:correctness, tests, performance, maintainability}
**Risk Profile** [OPTIONAL]: ${input:risk:low, medium, high}
---

## Interaction Style
1. Report findings first, ordered by severity.
2. Highlight AI slop and extension antipatterns.
3. Call out missing tests and risky behavior changes.
4. Provide concise remediation recommendations.

## Example
Review scope: scanner async refactor and tree status bar updates.
