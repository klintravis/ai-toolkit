---
name: async-file-operations
description: Async file discovery and non-blocking I O patterns for VS Code extensions, including workspace.findFiles usage, cancellation support, and progress reporting.
---

# Async File Operations

## Domain
High-throughput extension file discovery without blocking the extension host.

## When to Use This Skill
- Implementing or optimizing scanner logic.
- Replacing sync file access with async alternatives.
- Adding cancellation and progress for long scans.

## Methodology
1. Use async VS Code APIs first.
2. Pass cancellation tokens through scan pipelines.
3. Segment scan phases by asset type for partial results.
4. Report progress for large workspaces and external toolkit roots.
5. Normalize and dedupe paths before emitting results.

## Example Checks
- `workspace.findFiles` excludes noisy directories.
- Scan can be canceled without leaving stale state.
- Errors are collected and surfaced, not swallowed.

## Success Criteria
- [ ] No synchronous I/O on the extension host path.
- [ ] Scan cancellation works under load.
- [ ] User sees progress and actionable failures.
