---
name: extension-testing-strategies
description: Unit and integration testing strategies for VS Code extensions, including API mocking, fixture-driven tests, and async behavior validation.
---

# Extension Testing Strategies

## Domain
Testing architecture for TypeScript VS Code extensions.

## When to Use This Skill
- Creating first tests in an extension with no current suite.
- Testing scanner, tree provider, and settings logic.
- Building mocks for VS Code workspace and window APIs.

## Methodology
1. Test design first: define behavior and edge cases before implementation.
2. Mock VS Code APIs at module boundaries.
3. Use fixtures for folder layouts and asset discovery cases.
4. Cover async success and failure paths.
5. Keep tests small, deterministic, and isolated.

## Recommended Coverage Focus
- Discovery filters and path normalization.
- Tree item mapping and status state derivation.
- Settings update safety and rollback handling.

## Success Criteria
- [ ] Critical flows have unit tests.
- [ ] Async edge cases have explicit assertions.
- [ ] Test doubles are clear and maintainable.
