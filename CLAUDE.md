# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI Toolkit is a VS Code extension that manages Copilot customization assets (agents, instructions, skills, prompts, plugins, hooks, workflows, standards) from external folders. It discovers assets and configures VS Code User-level Copilot settings to point at those folders — no files are copied into the workspace.

It supports two source formats: **awesome-copilot** (assets at top-level folders) and **CopilotCustomizer** (assets under `.github/`). CopilotCustomizer takes priority when both are present.

The extension can also **clone toolkit repos from GitHub** into a managed directory (`~/.ai-toolkits` by default), track their remote + last-known SHA in extension globalState, **check for updates** via `git fetch`, and **pull updates** (fast-forward only) from the tree view.

Users can **pin individual assets** from any toolkit into a "My Picks" directory (`~/.ai-toolkits/my-picks` by default). Picks are materialized as **symlinks** (with junction fallback on Windows, full copy as final fallback), and the picks directory is auto-registered as a synthetic toolkit so Copilot discovers them normally. This gives per-asset enable/disable without sacrificing the folder-based nature of Copilot's discovery settings.

## Build & Development

```bash
npm install
npm run compile        # TypeScript → out/
npm run watch          # Compile on save
npm run lint           # ESLint on src/ and test/
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

- **`extension.ts`** — Entry point. Registers commands, wires up the scanner, tree provider, and settings manager. Manages global enable/disable state via `aiToolkit.enabledToolkits` setting. Includes a concurrency guard on refresh and normalized path comparison for add/remove operations.
- **`scanner.ts`** (`ToolkitScanner`) — Discovers toolkits by detecting source format, then walks asset folders matching file extensions per asset type. Returns `Toolkit[]` with all discovered `Asset` items. Generates stable toolkit IDs using tilde-relative paths.
- **`treeProvider.ts`** (`ToolkitTreeProvider`) — Renders toolkits as a VS Code TreeView. Three-level hierarchy: source folder → toolkit → asset type → asset. Exports `TreeNode` types. Implements `Disposable` for cleanup.
- **`copilotSettings.ts`** (`CopilotSettingsManager`) — Writes to VS Code User-level settings. Manages Copilot feature flags, `codeGeneration.instructions` entries, and `chat.*Locations` discovery paths. Converts absolute paths to `~/...` form when under the user's home directory.
- **`types.ts`** — Enums (`AssetType`, `SourceFormat`) and interfaces (`Asset`, `Toolkit`, `ToolkitUpdateStatus`, `ClonedToolkitRecord`).
- **`pathUtils.ts`** — Path normalization utilities: `expandHomePath`, `toHomeRelativePath`, `normalizeForComparison`, `isPathUnderAnyRoot`, `toToolkitId`. All paths are normalized to forward slashes internally.
- **`git.ts`** (`GitToolkitManager`) — Thin wrapper over the `git` CLI via `child_process.spawn` (never `shell: true`). Handles clone, fetch, pull (--ff-only), rev-parse. Returns typed `GitError` with specific codes (AUTH_REQUIRED, NETWORK_ERROR, PULL_NOT_FAST_FORWARD, etc.). Streams stderr to the output channel prefixed `[git]`.
- **`clonedToolkitsStore.ts`** (`ClonedToolkitsStore`) — Persists `ClonedToolkitRecord[]` in `ExtensionContext.globalState` under key `aiToolkit.clonedToolkits`. Used to distinguish cloned toolkits from user-added folders and to track SHAs.
- **`updateChecker.ts`** (`UpdateChecker`) — Runs `git fetch` + ahead/behind counts across cloned toolkits with bounded concurrency (4). Never throws; per-toolkit errors are recorded on `ToolkitUpdateStatus`.
- **`picks.ts`** (`PinManager` + `PinRecordStore`) — Materializes individually-pinned assets under the pins directory. `materializeAsset()` tries symlink first, junction for Windows directories, full copy as fallback when symlinks require elevated privileges. `resync()` refreshes `copy`-type pins after source updates and prunes records whose source has vanished. Stored in globalState under `aiToolkit.pickedAssets`.

## Key Design Decisions

- All Copilot configuration is written to **User-level** (global) settings, not workspace settings, so one toolkit install serves all workspaces.
- Paths under the user's home directory are stored as `~/...` tilde paths for cross-platform portability.
- Toolkit IDs use tilde-relative paths (e.g., `~/toolkits/my-kit`) for uniqueness and portability.
- The extension tracks which toolkit roots it manages via `aiToolkit.managedToolkitRoots` to cleanly remove settings on disable without disturbing user-added entries.
- Copilot feature flags are only turned ON (never removed) to avoid disabling features the user may have configured independently.
- TypeScript strict mode is enabled. Target is ES2022/CommonJS.
- Cloned-toolkit metadata (remote URL, last SHA) lives in `ExtensionContext.globalState`, **not** in user-visible settings. Settings are user-editable; clone metadata is internal and keyed to machine-local paths.
- Git operations shell out to the `git` CLI (no npm dep). This inherits the user's git config (credentials, proxies, signing) and keeps the extension dependency-free.
- Update checks are layered on **after** scanning — the scanner stays pure and unaware of git. Extension.ts annotates `Toolkit` objects with `isCloned` and `update` fields before handing them to the tree provider.
- Pins use **symlinks by default** so updates to the source propagate automatically. Only when the OS denies symlink creation do we fall back to a full copy (which is re-synced on git pull via `PinManager.resync()`).
- Pin-state discovery uses dual lookup: by original `assetId` for assets browsed inside their source toolkit, and by `sourcePath === record.targetPath` for the same asset when seen inside the pins toolkit. This lets the unpin action show up in both views.
- Nested asset children (files inside a folder-based skill/plugin/hook/standard) are **not individually pinnable** — users pin the parent folder asset as a unit. This keeps pins coherent with the unit-of-work semantics of skills.
