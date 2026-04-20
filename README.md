# AI Toolkit

A VS Code extension for sharing AI assets (GitHub Copilot agents, instructions, skills, Claude Code hooks, MCP servers) across your entire team. Point the extension at an external folder — a "toolkit" — and it writes the right paths into VS Code User-level settings and `~/.claude/settings.json` automatically. No files are copied into your workspace.

Works with the **[DualPlatform](#toolkit-format)** layout (both Copilot and Claude Code assets in one repo), **[awesome-copilot](https://github.com/github/awesome-copilot)**, and any folder following standard Copilot asset conventions.

---

## How It Works

Toolkits live in **external folders** on your machine (default `~/.ai-toolkits/`). When you enable a toolkit:

- Copilot asset paths are written into VS Code **User-level settings** so they apply across every workspace
- Claude Code hooks, MCP servers, and skills are written into `~/.claude/settings.json` and the Claude Code plugin registry
- Nothing is copied into your workspace — one install serves every project

---

## Installation

### Prerequisites

| Requirement | Notes |
|---|---|
| VS Code 1.96 or later | |
| GitHub Copilot extension | For Copilot assets |
| Claude Code | For Claude-side assets |
| Git on PATH | Required only for cloning toolkits from GitHub |

### Install from the `.vsix`

1. Download the latest `.vsix` from [Releases](https://github.com/klintravis/ai-toolkit/releases)
2. In VS Code: **Extensions** → `...` menu → **Install from VSIX…**
3. Select the file and reload when prompted

### Install from source

```bash
git clone https://github.com/klintravis/ai-toolkit.git
cd ai-toolkit
npm install
npm run package          # builds ai-toolkit-<version>.vsix
```

Then install the generated `.vsix` as above, or press **F5** to open the Extension Development Host.

---

## Quick Start

### 1 — Clone a toolkit from GitHub

Open the **AI Toolkits** panel in the Explorer sidebar. Click the **Clone** (cloud) button in the toolbar and paste a GitHub URL or `owner/repo` shorthand:

```
github/awesome-copilot
```

The extension clones into `~/.ai-toolkits/` and registers the toolkit automatically.

### 2 — Enable the toolkit

Click the checkmark next to the toolkit name. Copilot and Claude settings update immediately — no restart needed.

### 3 — Browse assets

Expand the toolkit to browse direct asset folders first, then the assets inside them. Dual-platform toolkits now flatten the top-level platform wrappers so they read more like the plugin tree, only adding prefixes where needed to distinguish folders such as **Copilot Hooks** and **Claude Hooks**.

### 4 — Pin your favourites

Right-click any asset → **Pin to My Picks**. Pinned assets appear under **My Picks** as their own toolkit and remain active even when the source toolkit is disabled.

---

## Dashboard

Click the **dashboard** icon in the sidebar toolbar (or run `AI Toolkit: Open Dashboard`) to open the visual overview. From here you can:

- Toggle toolkits on or off
- See and manage pinned assets
- Clone new toolkits and adjust settings

---

## Toolkit Format

The extension supports a **DualPlatform** folder layout that serves both GitHub Copilot and Claude Code from a single repo:

```
my-toolkit/
  ai-toolkit.json           # optional manifest
  copilot/
    agents/                 # *.agent.md         → Copilot agents
    instructions/           # *.instructions.md  → Copilot instructions
    prompts/                # *.prompt.md        → Copilot prompts
    plugins/                # folder-based       → Copilot plugins
    hooks/                  # folder-based       → Copilot hooks
    workflows/              # *.md               → Copilot workflows
  claude/
    skills/                 # folder-based       → Copilot AND Claude Code skills
    hooks/                  # *.json             → Claude Code hooks
    mcps/                   # *.json             → Claude Code MCP servers
    instructions/           # *.md               → Claude Code instructions (planned)
  shared/
    standards/              # folder-based       → visible in tree only
    docs/                   # *.md               → reference material
```

**Platform routing:**

| Folder | Configures |
|---|---|
| `copilot/*` | GitHub Copilot only |
| `claude/skills/` | Both Copilot AND Claude Code |
| `claude/hooks/`, `claude/mcps/`, `claude/instructions/` | Claude Code only |
| `shared/*` | Tree display only — no settings written |

See [docs/authoring-toolkits.md](docs/authoring-toolkits.md) for full authoring guidance.

See [docs/claude-code-integration.md](docs/claude-code-integration.md) for how Claude Code skills, hooks, and MCP servers are registered.

---

## Supported Asset Types

| Type | File pattern | Configured in |
|---|---|---|
| Agents | `*.agent.md` | `chat.agentFilesLocations` |
| Instructions | `*.instructions.md` | `chat.instructionsFilesLocations`, `codeGeneration.instructions` |
| Skills | subfolder with `SKILL.md` | `chat.agentSkillsLocations` + Claude plugin registry |
| Prompts | `*.prompt.md` | `chat.promptFilesLocations` |
| Copilot hooks | subfolder | `chat.hookFilesLocations` |
| Plugins | subfolder | workspace folder registration |
| Workflows | `*.md` | Tree display only (not registered with Copilot) |
| Standards | subfolder | tree display only |
| Claude hooks | `*.json` | `~/.claude/settings.json` → `hooks` |
| MCP servers | `*.json` | `~/.claude/settings.json` → `mcpServers` |

---

## My Picks (Pinning Individual Assets)

Picks let you curate a personal asset set from across multiple toolkits without forking anything.

| Action | How |
|---|---|
| Pin an asset | Right-click asset → **Pin to My Picks** |
| Unpin | Right-click pinned asset → **Unpin from My Picks** |
| Organise into groups | Right-click → **Move to Group…** or **Create Group** |
| Rename / delete a group | Right-click the group node |
| Open picks folder | `AI Toolkit: Open My Picks Folder` |

Picks are stored as symlinks (or file copies on Windows without Developer Mode) under `~/.ai-toolkits/my-picks/` and are registered as a synthetic toolkit so Copilot discovers them automatically.

---

## Updating Toolkits

The extension checks for updates on startup. When new commits are available an arrow icon appears next to the toolkit name.

| Action | How |
|---|---|
| Check for updates now | Toolbar sync button or `AI Toolkit: Check for Toolkit Updates` |
| Update one toolkit | Right-click toolkit → **Update Toolkit** |
| Update all toolkits | `AI Toolkit: Update All Toolkits` |

Updates use fast-forward-only pulls. If the remote history has diverged you will need to resolve the situation manually in a terminal.

---

## Adding Your Own Folders

1. Click **+** in the sidebar toolbar → **Add Toolkit Folder**
2. Browse to your folder
3. The extension scans it and adds it to the tree

To remove a folder: right-click the toolkit → **Remove Toolkit Folder**.

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| `aiToolkit.toolkitPaths` | `[]` | Folders to scan for toolkits |
| `aiToolkit.enabledToolkits` | `{}` | Per-toolkit enabled state |
| `aiToolkit.configureCopilotSettings` | `true` | Auto-write Copilot and Claude settings on enable/disable |
| `aiToolkit.cloneDirectory` | `~/.ai-toolkits` | Where cloned repos are stored |
| `aiToolkit.picksDirectory` | `~/.ai-toolkits/my-picks` | Where pinned assets are linked |
| `aiToolkit.checkForUpdatesOnStartup` | `true` | Check for updates after VS Code starts |
| `aiToolkit.updateCheckIntervalMinutes` | `0` | Periodic update interval in minutes (0 = disabled) |
| `aiToolkit.claudeSettingsPath` | `~/.claude/settings.json` | Path to Claude Code settings |
| `aiToolkit.claudePluginsPath` | `~/.ai-toolkits/claude-plugins` | Where skill plugin directories are materialized |
| `aiToolkit.claudePluginsRegistryPath` | `~/.claude/plugins` | Claude Code plugin registry directory |

---

## Command Reference

| Command | Description |
|---|---|
| `AI Toolkit: Add Toolkit Folder` | Browse for a local toolkit folder |
| `AI Toolkit: Clone Toolkit from GitHub…` | Clone a GitHub repo into the clone directory |
| `AI Toolkit: Enable Toolkit` | Enable a toolkit and update settings |
| `AI Toolkit: Disable Toolkit` | Disable a toolkit and remove its settings entries |
| `AI Toolkit: Enable All Toolkits` | Enable all registered toolkits |
| `AI Toolkit: Disable All Toolkits` | Disable all and clean managed settings |
| `AI Toolkit: Refresh Toolkits` | Re-scan all configured folders |
| `AI Toolkit: Check for Toolkit Updates` | Fetch remotes and show update badges |
| `AI Toolkit: Update Toolkit` | Pull updates for a specific cloned toolkit |
| `AI Toolkit: Update All Toolkits` | Pull updates for all cloned toolkits |
| `AI Toolkit: Open Dashboard` | Open the visual dashboard |
| `AI Toolkit: Pin to My Picks` | Pin the selected asset to My Picks |
| `AI Toolkit: Unpin from My Picks` | Remove the selected asset from My Picks |
| `AI Toolkit: Create Group` | Create a new picks group |
| `AI Toolkit: Delete Group` | Delete a picks group and its contents |
| `AI Toolkit: Rename Group` | Rename a picks group |
| `AI Toolkit: Move to Group…` | Move a pinned asset to a different group |
| `AI Toolkit: Open My Picks Folder` | Reveal the picks directory in the file explorer |
| `AI Toolkit: Add to Workspace` | Add a toolkit folder to the workspace |
| `AI Toolkit: Remove from Workspace` | Remove a toolkit folder from the workspace |

---

## Troubleshooting

**Copilot isn't picking up assets after enabling a toolkit**
Open VS Code settings (`Ctrl+,`) and search for `chat.agentFilesLocations`. The toolkit's asset folders should appear. If they don't, run `AI Toolkit: Refresh Toolkits` and check the **AI Toolkit** output channel.

**Clone fails with an authentication error**
The extension uses your system git config for credentials. Run `git clone <url>` in a terminal first to trigger your credential helper, then retry the clone in the extension.

**Symlinks not working on Windows**
Windows requires Developer Mode or administrator rights to create symlinks. If neither is available, the extension automatically falls back to full file copies, which work identically from Copilot's and Claude's perspective.

**A pinned asset isn't showing up**
Run `AI Toolkit: Refresh Toolkits`. If the source file was moved or deleted, the extension prunes the stale pin automatically.

**Claude Code skills or hooks aren't loading**
Check `~/.claude/settings.json` to confirm the plugin key (`<toolkit-name>@ai-toolkit`) is present under the enabled plugins list. Also verify that `~/.claude/plugins/installed_plugins.json` contains an entry for the toolkit. Run **Refresh Toolkits** to force a re-write.

---

## Contributing

```bash
git clone https://github.com/klintravis/ai-toolkit.git
cd ai-toolkit
npm install
npm run watch        # compile on save
```

Press **F5** to launch the Extension Development Host.

```bash
npm run check        # lint + tests (must pass before opening a PR)
npm run package      # build .vsix
```

Tests use Node.js built-in `node:test` — no external framework needed.

---

## License

MIT
