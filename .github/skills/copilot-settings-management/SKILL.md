---
name: copilot-settings-management
description: Manage and evolve Copilot chat discovery settings with schema-aware updates, migration safety, and release monitoring for chat.*FilesLocations keys.
---

# Copilot Settings Management

## Domain
Safe management of GitHub Copilot discovery configuration in VS Code user settings.

## When to Use This Skill
- Updating discovery location handling.
- Migrating from deprecated settings keys.
- Validating compatibility with new Copilot releases.

## Methodology
1. Track current supported settings keys.
2. Read-modify-write settings atomically.
3. Avoid duplicate paths and stale entries.
4. Preserve user-managed values that are outside extension scope.
5. Document migrations and fallback behavior.

## Current Key Family
- `chat.instructionsFilesLocations`
- `chat.agentFilesLocations`
- `chat.promptFilesLocations`
- `chat.agentSkillsLocations`
- `chat.hookFilesLocations`

## Success Criteria
- [ ] Managed settings stay valid and deduplicated.
- [ ] Backward-incompatible keys are not introduced.
- [ ] Changes are auditable and reversible.
