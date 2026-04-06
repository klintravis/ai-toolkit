---
name: test-module
description: Generate a test file for a given source module using project conventions (node:test + node:assert/strict)
---

# Generate Test Module

Generate a test file for the specified source module.

## Arguments
- `module` (required): The source module name (e.g., `scanner`, `picks`, `git`)

## Steps

1. Read the source file at `src/{module}.ts` to understand its exports and public API
2. Check if `test/{module}.test.js` already exists -- if so, read it and add missing tests rather than overwriting
3. Generate tests following the test-writer agent conventions:
   - Use `node:test` and `node:assert/strict`
   - Plain `.js` file in `test/`
   - Create/clean temp directories
   - Test public API, edge cases, error paths
4. Compile with `npm run compile` to ensure the source is built
5. Run the new tests with `node --test test/{module}.test.js`
6. Fix any failures until all tests pass
