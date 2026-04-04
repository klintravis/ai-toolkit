# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI Toolkit is a VS Code extension that manages Copilot customization assets (agents, instructions, skills, prompts, plugins, hooks, workflows, standards) from external folders. It discovers assets and configures VS Code User-level Copilot settings to point at those folders — no files are copied into the workspace.

It supports two source formats: **awesome-copilot** (assets at top-level folders) and **CopilotCustomizer** (assets under `.github/`), plus a generic fallback.

## Build & Development

```bash
npm install
npm run compile        # TypeScript → out/
npm run watch          # Compile on save
npm run lint           # ESLint on src/
npm test               # Compile + run all tests
npm run check          # Lint + test in one go
npm run package        # Build .vsix
```

Run a single test file: `npm run compile && node --test test/scanner.test.js`

Press **F5** in VS Code to launch the Extension Development Host.

## Testing

Tests use Node.js built-in `node:test` and `node:assert/strict` — no external test framework. Test files live in `test/` as plain `.js` files (not TypeScript). Tests create temp directories, run scanner/utility functions, and clean up.

## Architecture

The extension follows a pipeline: **scan → display → configure**.

- **`extension.ts`** — Entry point. Registers commands, wires up the scanner, tree provider, and settings manager. Manages global enable/disable state via `aiToolkit.enabledToolkits` setting.
- **`scanner.ts`** (`ToolkitScanner`) — Discovers toolkits by detecting source format, then walks asset folders matching file patterns from `ASSET_PATTERNS`. Returns `Toolkit[]` with all discovered `Asset` items.
- **`treeProvider.ts`** (`ToolkitTreeProvider`) — Renders toolkits as a VS Code TreeView. Three-level hierarchy: source folder → toolkit → asset. Uses `contextValue` (`toolkit-enabled`, `asset-disabled`, etc.) to drive context menu visibility.
- **`copilotSettings.ts`** (`CopilotSettingsManager`) — Writes to VS Code User-level settings. Manages Copilot feature flags, `codeGeneration.instructions` entries, and `chat.*Locations` discovery paths. Converts absolute paths to `~/...` form when under the user's home directory.
- **`types.ts`** — Enums (`AssetType`, `SourceFormat`), interfaces (`Asset`, `Toolkit`), and constants (`ASSET_PATTERNS`, `TARGET_SUBDIRS`).
- **`pathUtils.ts`** — Path normalization utilities: `toForwardSlash`, `toTildePath`, `fromTildePath`, `isSubPath`. All paths are normalized to forward slashes internally.

## Key Design Decisions

- All Copilot configuration is written to **User-level** (global) settings, not workspace settings, so one toolkit install serves all workspaces.
- Paths under the user's home directory are stored as `~/...` tilde paths for cross-platform portability.
- The extension tracks which toolkit roots it manages via `aiToolkit.managedToolkitRoots` to cleanly remove settings on disable without disturbing user-added entries.
- TypeScript strict mode is enabled. Target is ES2022/CommonJS.
