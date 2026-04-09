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
    hooks/                 ← JSON/YAML files describing Claude Code hooks
    mcps/                  ← JSON/YAML files describing MCP server configs
    instructions/          ← CLAUDE.md-style instruction files (Claude-specific)
```

**Platform rules:**
- `claude/skills/` is the only cross-platform folder — skills here work in both Claude Code and Copilot
- All `copilot/*` assets are Copilot-only
- `claude/hooks/`, `claude/mcps/`, `claude/instructions/` are Claude Code-only
- `shared/*` assets are surfaced in the tree view but not written to either platform's settings

**Hook file format** (`claude/hooks/<name>.json`):
```json
{ "event": "PreToolUse", "matcher": "Bash", "command": "./scripts/lint.sh" }
```
`command` paths are relative to the toolkit root. The extension resolves them to absolute paths before writing to `~/.claude/settings.json`.

**MCP file format** (`claude/mcps/<name>.json`):
```json
{ "name": "my-server", "command": "node", "args": ["./server.js"], "env": {} }
```
The `"name"` field becomes the key under `mcpServers` in `~/.claude/settings.json`, prefixed by toolkit name: `<toolkit-name>/<server-name>`. `args` paths relative to toolkit root are also resolved to absolute paths.

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

The fixed enum is replaced with a string union + well-known constants so new types (e.g. `"linters"`, `"templates"`) work without code changes:

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

### SourceFormat

```typescript
export enum SourceFormat {
  DualPlatform = 'dual-platform',
  // AwesomeCopilot and CopilotCustomizer removed
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
}
```

---

## 3. Configurable Asset Mappings

Mappings are resolved at two levels, merged in order:

### Level 1 — Extension settings (`aiToolkit.assetMappings`)

Default value in `package.json`:

```json
[
  { "folder": "copilot/agents",       "assetType": "agents",       "platform": "copilot" },
  { "folder": "copilot/instructions", "assetType": "instructions", "platform": "copilot" },
  { "folder": "copilot/prompts",      "assetType": "prompts",      "platform": "copilot" },
  { "folder": "copilot/plugins",      "assetType": "plugins",      "platform": "copilot" },
  { "folder": "copilot/hooks",        "assetType": "hooks",        "platform": "copilot" },
  { "folder": "copilot/workflows",    "assetType": "workflows",    "platform": "copilot" },
  { "folder": "claude/skills",        "assetType": "skills",       "platform": "both"    },
  { "folder": "claude/hooks",         "assetType": "hooks",        "platform": "claude"  },
  { "folder": "claude/mcps",          "assetType": "mcps",         "platform": "claude"  },
  { "folder": "claude/instructions",  "assetType": "instructions", "platform": "claude"  },
  { "folder": "shared/standards",     "assetType": "standards",    "platform": "shared"  },
  { "folder": "shared/docs",          "assetType": "docs",         "platform": "shared"  }
]
```

Users can edit this in VS Code settings to add, remove, or remap folders without touching code.

### Level 2 — Per-toolkit manifest (`ai-toolkit.json`)

Repo authors can declare extra mappings or override defaults:

```json
{
  "name": "My Team Toolkit",
  "mappings": [
    { "folder": "custom/linters", "assetType": "standards", "platform": "shared" }
  ]
}
```

The scanner merges Level 2 on top of Level 1. Invalid manifest entries are logged and skipped — a bad manifest does not break toolkit discovery.

---

## 4. Scanner Changes

### Format detection

A directory is a `DualPlatform` toolkit when at least one of its immediate subpaths matches a configured mapping folder prefix (`copilot/`, `claude/`, or `shared/` by default). The old `.github/` and top-level asset-folder detection is removed.

### Scan pipeline

```
scanPath(rootPath)
  └─ detectFormat()        — checks for known mapping folder prefixes
  └─ loadMappings()        — merges extension settings + ai-toolkit.json
  └─ scanToolkit()
       └─ for each mapping
            └─ scanAssetFolder(mapping.folder, mapping.assetType, mapping.platform)
                 └─ produces Asset[] with platform set from mapping
```

### What is removed

- `SourceFormat.AwesomeCopilot` and `CopilotCustomizer` detection
- Hardcoded `AssetType` folder walking
- `mergeGithub` / `.github/` path logic
- `hasAssetFolders()` method

### What is unchanged

Containment check, symlink handling (file symlinks allowed, directory symlinks contained), cycle detection via `visited` set, and `readDirSafe` — all format-agnostic logic is preserved as-is.

---

## 5. Settings Managers

### CopilotSettingsManager (updated)

Filters to assets where `platform === 'copilot' || platform === 'both'`.

- `claude/skills/` folders are registered in `chat.agentSkillsLocations` — same mechanism, different source path
- `shared/standards/` assets appear in the tree view only; Copilot has no standards discovery path
- `DISCOVERY_LOCATION_SETTINGS` is derived from active asset mappings rather than hardcoded

### ClaudeSettingsManager (new)

Filters to assets where `platform === 'claude' || platform === 'both'`. Writes to `~/.claude/settings.json` and the managed plugin directory.

**Skills (`platform: 'both'`):**  
Symlinks each skill folder into a managed Claude plugin directory:
```
~/.ai-toolkits/claude-plugins/<toolkit-name>/skills/<skill-name>/ → source folder
```
Adds the plugin path to Claude Code's settings under the `pluginDirectories` key (or equivalent — exact key to be confirmed against Claude Code settings schema during implementation).

**Hooks (`claude/hooks/*.json`):**  
Reads each hook file, merges into `~/.claude/settings.json` under `hooks`. Managed hooks are keyed by `<toolkit-name>/<hook-name>` to avoid collisions and enable clean removal on disable.

**MCPs (`claude/mcps/*.json`):**  
Same pattern — reads each MCP file, merges into `~/.claude/settings.json` under `mcpServers`. Keys follow `<toolkit-name>/<server-name>`.

**Instructions (`claude/instructions/*.md`):**  
Appends absolute file path references into a clearly delimited managed section of `~/.claude/CLAUDE.md`:
```markdown
<!-- AI Toolkit managed — do not edit this section manually -->
@path/to/toolkit/claude/instructions/my-rules.md
<!-- /AI Toolkit managed -->
```
Entries outside the managed section are never touched.

**Managed-entry tracking:**  
Mirrors the Copilot manager's `aiToolkit.managedToolkitRoots` pattern — the Claude manager tracks which entries in `settings.json` it owns so disabling a toolkit cleanly removes only its contributions without touching user-defined entries.

---

## 6. Extension Settings

New entries in `package.json` `contributes.configuration`:

| Setting | Type | Description |
|---|---|---|
| `aiToolkit.assetMappings` | `AssetMapping[]` | Full mapping table with defaults (see Section 3) |
| `aiToolkit.defaultRepositories` | `object[]` | Seeded repos shown in dashboard as suggested clones |
| `aiToolkit.claudeSettingsPath` | `string` | Path to `~/.claude/settings.json` (default: `~/.claude/settings.json`) |
| `aiToolkit.claudePluginsPath` | `string` | Where Claude skill plugins are materialized (default: `~/.ai-toolkits/claude-plugins`) |

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

## 8. What Is Not Changing

- Git clone/fetch/pull pipeline (`git.ts`, `updateChecker.ts`, `clonedToolkitsStore.ts`)
- Pin/picks system (`picks.ts`) — gains `platform` on `PinRecord` but otherwise unchanged
- Path utilities (`pathUtils.ts`)
- Extension activation, command registration, and refresh lifecycle (`extension.ts`)
- Test framework (Node.js `node:test` + `node:assert/strict`)

---

## Open Questions

None — all design decisions resolved.
