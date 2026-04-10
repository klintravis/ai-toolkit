# Claude Assets Support — Design Spec

**Date:** 2026-04-09  
**Status:** Approved  

## Overview

Extend AI Toolkit to support Claude Code assets (skills, hooks, MCP servers, instructions) alongside existing GitHub Copilot assets. A new `DualPlatform` toolkit format replaces the two existing formats (`AwesomeCopilot`, `CopilotCustomizer`). Asset-to-platform mappings are fully configurable — no folder paths or asset types are hardcoded in source.

---

## 1. Toolkit Repo Structure

All toolkit repos adopt a single canonical layout. The old top-level and `.github/` formats are retired.

```
my-toolkit/
  ai-toolkit.json          ← optional per-repo manifest
  shared/
    standards/             ← coding standards, style guides (platform-agnostic)
    docs/                  ← reference material
  copilot/
    agents/                ← *.agent.md
    instructions/          ← *.instructions.md (Copilot-specific)
    prompts/               ← *.prompt.md
    plugins/               ← folder-based
    hooks/                 ← folder-based (Copilot hooks)
    workflows/             ← *.md
  claude/
    skills/                ← folder-based — SHARED: also registered with Copilot
    hooks/                 ← JSON files describing Claude Code hooks
    mcps/                  ← JSON files describing MCP server configs
    instructions/          ← CLAUDE.md-style instruction files (Claude-specific)
```

**Platform rules:**
- `claude/skills/` is the only cross-platform folder — skills here work in both Claude Code and Copilot
- All `copilot/*` assets are Copilot-only
- `claude/hooks/`, `claude/mcps/`, `claude/instructions/` are Claude Code-only
- `shared/*` assets are surfaced in the tree view but not written to either platform's settings

**Hook file format** (`claude/hooks/<name>.json`):
```json
{
  "event": "PreToolUse",
  "matcher": "Bash",
  "command": "./scripts/lint.sh"
}
```
`command` paths are relative to the toolkit root and are resolved to absolute paths before writing to `~/.claude/settings.json`. This flat format maps to Claude Code's native nested structure:
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "/abs/path/lint.sh" }] }
    ]
  }
}
```

**MCP file format** (`claude/mcps/<name>.json`):
```json
{
  "name": "my-server",
  "command": "node",
  "args": ["./server.js"],
  "env": {}
}
```
`"name"` becomes the `mcpServers` key in `~/.claude/settings.json`, namespaced as `<toolkit-name>__<server-name>` (double underscore, no slashes — avoids JSON key parsing issues). Any `args` entries that are relative paths are resolved to absolute paths.

---

## 2. Type Model Changes

### Asset platform field

```typescript
export interface Asset {
  // ... all existing fields unchanged ...
  platform: 'copilot' | 'claude' | 'both' | 'shared';
}
```

### AssetType becomes an open string type

The fixed enum is replaced with a string type + well-known constants so new types (e.g. `"linters"`, `"templates"`) work without code changes. Existing code using `AssetType.Skill` continues to work — the value is still the string `"skills"`.

```typescript
export type AssetType = string;
export const AssetType = {
  Agent: 'agents',
  Instruction: 'instructions',
  Skill: 'skills',
  Prompt: 'prompts',
  Plugin: 'plugins',
  Hook: 'hooks',
  Workflow: 'workflows',
  McpServer: 'mcps',
  Standard: 'standards',
  Doc: 'docs',
} as const;
```

**Impact on scanner:** The existing `isFolderAsset()` method (which hardcodes which types are folder-based) is removed. Whether a mapping produces file or folder assets is now declared in the `AssetMapping` itself via `isFolder` (see below).

### SourceFormat

```typescript
export enum SourceFormat {
  DualPlatform = 'dual-platform',
  // AwesomeCopilot and CopilotCustomizer removed.
  // Single value for now — kept as enum for forward extensibility.
}
```

### AssetMapping (new)

```typescript
export interface AssetMapping {
  /** Relative folder path within the toolkit root (e.g. "claude/skills"). */
  folder: string;
  /** Asset type string (e.g. "skills", "mcps"). */
  assetType: AssetType;
  /** Which platform(s) this folder's assets belong to. */
  platform: 'copilot' | 'claude' | 'both' | 'shared';
  /**
   * When true, each subdirectory of this folder is treated as a single folder
   * asset (e.g. skills, plugins). When false (default), the scanner walks for
   * individual files. Replaces the hardcoded isFolderAsset() check.
   */
  isFolder?: boolean;
}
```

---

## 3. Configurable Asset Mappings

Mappings are resolved at two levels:

### Level 1 — Extension settings (`aiToolkit.assetMappings`)

Default value in `package.json`:

```json
[
  { "folder": "copilot/agents",       "assetType": "agents",       "platform": "copilot", "isFolder": false },
  { "folder": "copilot/instructions", "assetType": "instructions", "platform": "copilot", "isFolder": false },
  { "folder": "copilot/prompts",      "assetType": "prompts",      "platform": "copilot", "isFolder": false },
  { "folder": "copilot/plugins",      "assetType": "plugins",      "platform": "copilot", "isFolder": true  },
  { "folder": "copilot/hooks",        "assetType": "hooks",        "platform": "copilot", "isFolder": true  },
  { "folder": "copilot/workflows",    "assetType": "workflows",    "platform": "copilot", "isFolder": false },
  { "folder": "claude/skills",        "assetType": "skills",       "platform": "both",    "isFolder": true  },
  { "folder": "claude/hooks",         "assetType": "hooks",        "platform": "claude",  "isFolder": false },
  { "folder": "claude/mcps",          "assetType": "mcps",         "platform": "claude",  "isFolder": false },
  { "folder": "claude/instructions",  "assetType": "instructions", "platform": "claude",  "isFolder": false },
  { "folder": "shared/standards",     "assetType": "standards",    "platform": "shared",  "isFolder": true  },
  { "folder": "shared/docs",          "assetType": "docs",         "platform": "shared",  "isFolder": false }
]
```

### Level 2 — Per-toolkit manifest (`ai-toolkit.json`)

Repo authors can declare **additional** mappings. Per-toolkit entries are **additive only** — they cannot remove or override extension-level defaults. This prevents a malicious or broken toolkit manifest from disabling the user's configured mappings.

```json
{
  "name": "My Team Toolkit",
  "mappings": [
    { "folder": "custom/linters", "assetType": "standards", "platform": "shared", "isFolder": false }
  ]
}
```

Invalid manifest entries are logged and skipped — a bad manifest does not break toolkit discovery.

### Format detection and manifest loading order

Format detection runs **before** the per-toolkit manifest is loaded, using only the extension-level defaults to identify known folder prefixes (`copilot/`, `claude/`, `shared/`). Once a directory is confirmed as a toolkit, the manifest is loaded and its additional mappings are appended. This avoids the chicken-and-egg problem of needing the manifest to detect the format.

---

## 4. Scanner Changes

### Format detection

A directory is a `DualPlatform` toolkit when at least one of its immediate subpaths matches a top-level prefix from the extension-level default mappings (`copilot/`, `claude/`, or `shared/`). The old `.github/` and top-level asset-folder detection is removed.

### Scan pipeline

```
scanPath(rootPath)
  └─ detectFormat()        — checks for copilot/, claude/, shared/ using defaults only
  └─ loadManifest()        — reads ai-toolkit.json if present, validates, appends mappings
  └─ scanToolkit()
       └─ for each mapping
            └─ scanAssetFolder(mapping)
                 └─ if mapping.isFolder: each subdir → folder Asset
                    else: each file → file Asset
                 └─ produces Asset[] with platform set from mapping
```

### What is removed

- `SourceFormat.AwesomeCopilot` and `CopilotCustomizer` detection
- Hardcoded `AssetType` folder walking
- `mergeGithub` / `.github/` path logic
- `hasAssetFolders()` method
- `isFolderAsset()` method (replaced by `mapping.isFolder`)

### What is unchanged

Containment check, symlink handling (file symlinks allowed, directory symlinks contained), cycle detection via `visited` set, and `readDirSafe` — all format-agnostic logic is preserved as-is.

---

## 5. Settings Managers

### CopilotSettingsManager (updated)

Filters to assets where `platform === 'copilot' || platform === 'both'`.

- `claude/skills/` folders are registered in `chat.agentSkillsLocations` — same mechanism, different source path
- `shared/standards/` assets appear in the tree view only; Copilot has no standards discovery path
- `DISCOVERY_LOCATION_SETTINGS` is derived from active asset mappings rather than hardcoded
- Uses `vscode.workspace.getConfiguration()` as before — no change to the VS Code API surface

### ClaudeSettingsManager (new)

Filters to assets where `platform === 'claude' || platform === 'both'`. Unlike `CopilotSettingsManager`, this manager uses Node.js `fs` directly to read and write `~/.claude/settings.json` — VS Code's configuration API only covers VS Code settings, not Claude Code's config file.

**`~/.claude/settings.json` handling:**
- If the file does not exist, create it with `{}` before merging
- If the file exists but is malformed JSON, log the error and abort (never overwrite corrupted user config)
- All writes are atomic: write to a temp file, then rename into place

**Skills (`platform: 'both'`):**  
Symlinks each skill folder into a managed Claude plugin directory:
```
~/.ai-toolkits/claude-plugins/<toolkit-name>/skills/<skill-name>/ → source folder
```
Registers the plugin path in Claude Code's settings. The exact settings key (`pluginDirectories` or equivalent) must be confirmed against the Claude Code settings schema during implementation.

**Hooks (`claude/hooks/*.json`):**  
Reads each hook file, merges into `~/.claude/settings.json` under `hooks` using the full nested structure. Managed hooks are identified by a `_managedBy` comment convention or tracked in extension `globalState` (same approach as `managedToolkitRoots`) so they can be cleanly removed on disable without touching user-defined hooks.

**MCPs (`claude/mcps/*.json`):**  
Reads each MCP file, merges into `~/.claude/settings.json` under `mcpServers` with key `<toolkit-name>__<server-name>`. Removes managed keys when toolkit is disabled.

**Instructions (`claude/instructions/*.md`):**  
Writes absolute path references into a clearly delimited managed block in `~/.claude/CLAUDE.md`. The exact import syntax (`@path`, `!include`, or other) must be confirmed against Claude Code's CLAUDE.md specification during implementation. The block is clearly delimited so entries outside it are never touched:
```markdown
<!-- AI Toolkit managed — do not edit this section manually -->
<!-- entries here -->
<!-- /AI Toolkit managed -->
```

**Managed-entry tracking:**  
Stores managed keys in `ExtensionContext.globalState` under `aiToolkit.claudeManagedEntries` — mirrors the pattern used by `CopilotSettingsManager` for `managedToolkitRoots`.

---

## 6. Extension Settings

New entries in `package.json` `contributes.configuration`:

| Setting | Type | Description |
|---|---|---|
| `aiToolkit.assetMappings` | `AssetMapping[]` | Full mapping table with defaults (see Section 3) |
| `aiToolkit.defaultRepositories` | `object[]` | Seeded repos shown in dashboard as suggested clones |
| `aiToolkit.claudeSettingsPath` | `string` | Path to `~/.claude/settings.json` (default: `~/.claude/settings.json`) |
| `aiToolkit.claudePluginsPath` | `string` | Root directory where the extension materializes Claude skill plugin folders, one subdirectory per toolkit (default: `~/.ai-toolkits/claude-plugins`) |

**`aiToolkit.defaultRepositories` default value:**
```json
[
  {
    "name": "Awesome Copilot",
    "url": "https://github.com/github/awesome-copilot",
    "description": "Official GitHub Copilot customizations"
  },
  {
    "name": "Claude Code Plugins",
    "url": "https://github.com/anthropics/claude-code-plugins",
    "description": "Official Claude Code skills and hooks"
  }
]
```

No repo URLs are hardcoded in source. The dashboard renders `defaultRepositories` as a quick-pick list — one click to clone a suggested repo.

---

## 7. Tree View Changes

**Toolkit node:** Shows per-platform asset counts:
```
▼ my-toolkit  [Copilot: 12 | Claude: 8 | Both: 5 | Shared: 3]
```

**Asset nodes:** Platform badge inline on each asset:
```
▼ claude/skills
    ⚡ my-skill  [Both]
▼ copilot/agents
    🤖 my-agent  [Copilot]
▼ claude/hooks
    🔗 on-session-start  [Claude]
▼ shared/standards
    📋 typescript-style  [Shared]
```

**Context menu additions:**
- `platform: 'both'` assets: "Open in Copilot" + "Open in Claude" context actions
- Claude hooks/MCPs: "View in ~/.claude/settings.json" action
- Pinning: unchanged — pins carry the `platform` field so the picks toolkit registers the pinned asset with the correct manager

**No structural change** to the three-level tree hierarchy. Platform is surfaced as metadata on existing nodes, not a new tree level.

---

## 8. What Is Changing vs. Not Changing

### Files that change

| File | What changes |
|---|---|
| `src/types.ts` | `AssetType` open string type, `platform` on `Asset` and `PinRecord`, `AssetMapping` interface, `SourceFormat` simplified |
| `src/scanner.ts` | New format detection, mapping-driven scan, manifest loading, `isFolderAsset` removed |
| `src/copilotSettings.ts` | Filter by platform, derive discovery settings from mappings |
| `src/extension.ts` | Instantiate `ClaudeSettingsManager`, call it alongside Copilot manager on refresh, register new commands |
| `package.json` | New settings: `assetMappings`, `defaultRepositories`, `claudeSettingsPath`, `claudePluginsPath` |
| `src/treeProvider.ts` | Platform badges on asset nodes, platform counts on toolkit nodes |

### New files

| File | Purpose |
|---|---|
| `src/claudeSettings.ts` | `ClaudeSettingsManager` — reads/writes `~/.claude/settings.json` and manages plugin symlinks |
| `test/claudeSettings.test.js` | Tests for `ClaudeSettingsManager` |

### Files that do not change

- `src/git.ts`, `src/updateChecker.ts`, `src/clonedToolkitsStore.ts` — git pipeline unchanged
- `src/picks.ts` — gains `platform` on `PinRecord` only (minor type update)
- `src/pathUtils.ts` — no changes needed
- Test framework — stays `node:test` + `node:assert/strict`

---

## 9. Migration

Existing users with toolkits in the old `awesome-copilot` or `copilot-customizer` format will see those toolkits scan as empty (no `copilot/`, `claude/`, or `shared/` subfolders found). The extension will show a one-time warning:

> "One or more toolkits use the old format and need to be migrated to the new DualPlatform layout. See [link to migration guide]."

No automatic migration — users must reorganize their toolkit repo folder structure manually or wait for the repo maintainer to publish an updated version. The warning links to documentation explaining the new structure.

---

## 10. Test Strategy

- `test/scanner.test.js` — updated to use new DualPlatform fixtures; old format fixture tests removed
- `test/claudeSettings.test.js` — new file; tests hook merging, MCP merging, skill symlinking, create-if-missing for `settings.json`, malformed JSON guard, disable/cleanup
- `test/picks.test.js` — minor updates for `platform` field on `PinRecord`
- All tests create temp directories and clean up, consistent with existing test patterns

---

## Open Questions

- **Claude Code plugin directory settings key:** The exact `~/.claude/settings.json` key for registering plugin directories must be confirmed against the Claude Code settings schema before implementing `ClaudeSettingsManager` skills support.
- **CLAUDE.md import syntax:** The exact syntax for referencing external `.md` files in `~/.claude/CLAUDE.md` must be confirmed before implementing instructions support.
