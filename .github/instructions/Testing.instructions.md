---
applyTo: '**/*.test.ts'
description: Testing rules for AI Toolkit extension behavior with VS Code API mocks, fixtures, and async assertions.
---

# Testing Instructions

## Context Overview
Tests should validate extension behavior for scanning external toolkit assets, settings synchronization, and tree rendering logic.

## Constraints
- Keep tests deterministic and isolated from local machine state.
- Prefer fixtures over ad hoc filesystem assumptions.
- Avoid flaky timing checks.

## Testing Standards
- Arrange-Act-Assert structure in each test.
- Mock VS Code APIs at boundaries (`workspace`, `window`, `commands`).
- Explicitly test async behavior with awaited assertions.
- Include negative-path tests for scan failures and invalid configuration.
- Verify shape of emitted tree items and status metadata when applicable.

## Test Data Patterns
- Use fixture directories representing toolkit layouts.
- Include cases for missing folders, mixed asset types, and partial failures.

## Acceptance Criteria
- At least one positive and one negative test for each changed behavior.
- Assertions describe expected user-visible impact.
- Tests avoid hidden dependencies on ordering or machine-specific paths.

## Example
- Good: scanner test validates cancellation stops further file matching.
- Bad: scanner test relies on wall-clock delay and random timeout values.
