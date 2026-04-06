# AI Toolkit

A VS Code extension for managing GitHub Copilot customization assets across your team. Clone toolkits from GitHub, enable them with one click, and pin your favourite individual assets — all without touching your workspace files.

Works with **[awesome-copilot](https://github.com/github/awesome-copilot)**, **[CopilotCustomizer](https://github.com/klintravis/CopilotCustomizer)**, or any folder following standard Copilot asset layout conventions.

---

## How It Works

Toolkits live in **external folders** on your machine (e.g. `~/.ai-toolkits/`). When you enable a toolkit the extension writes paths into your VS Code **User-level settings** so Copilot discovers the assets directly — nothing is copied into your workspace.

- One copy of a toolkit serves every workspace on your machine
- Enable and disable toolkits globally from the sidebar or dashboard
- Updates to a cloned toolkit are pulled in with a single click

---

## Installation

### Prerequisites

- VS Code 1.96 or later
- GitHub Copilot extension installed and active
- Git on your PATH (required only for cloning toolkits)

### Install from the `.vsix`

1. Download the latest `.vsix` from [Releases](https://github.com/klintravis/ai-toolkit/releases)
2. In VS Code: **Extensions** → `...` menu → **Install from VSIX…**
3. Select the downloaded file and reload when prompted

### Install from source

```bash
git clone https://github.com/klintravis/ai-toolkit.git
cd ai-toolkit
npm install
npm run package          # builds ai-toolkit-0.1.0.vsix
```

Then install the generated `.vsix` as above, or press **F5** to launch the Extension Development Host for a live test session.

---

## Quick Start

### 1 — Clone a community toolkit

Open the AI Toolkit sidebar (look for the hexagon icon in the activity bar), then click the **Clone** button (cloud icon) in the toolbar.

Paste a GitHub URL or `owner/repo` shorthand — for example:

```
github/awesome-copilot
```

The extension clones into `~/.ai-toolkits/` and automatically registers the toolkit.

### 2 — Enable the toolkit

Click the **enable** checkmark next to the toolkit name. Copilot settings are updated immediately — no restart needed.

### 3 — Browse assets

Expand the toolkit in the tree to see agents, instructions, skills, prompts, and more. Click any asset to open it in the editor.

### 4 — Pin your favourites

Right-click any asset and choose **Pin to My Picks**. Pinned assets appear under **My Picks** as their own toolkit and stay active even when the source toolkit is disabled.

---

## Dashboard

Click the **dashboard** icon in the sidebar toolbar (or run `AI Toolkit: Open Dashboard` from the Command Palette) to open the visual overview. From here you can:

- Toggle any toolkit on or off
- See all your pinned assets and manage groups
- Clone new toolkits, check for updates, and adjust settings

---

## Updating Toolkits

The extension checks cloned toolkits for updates on startup (configurable). When updates are available an arrow icon appears next to the toolkit name — click it to fast-forward pull. You can also:

- **Check now:** toolbar sync button or `AI Toolkit: Check for Toolkit Updates`
- **Update one:** right-click → Update Toolkit
- **Update all:** `AI Toolkit: Update All Toolkits`

---

## My Picks (Pinning Individual Assets)

Picks let you curate a personal set of assets from across multiple toolkits.

| Action | How |
|--------|-----|
| Pin an asset | Right-click asset → **Pin to My Picks** |
| Unpin | Right-click pinned asset → **Unpin from My Picks** |
| Organise into groups | Right-click → **Move to Group…**, or use **Create Group** |
| Rename / delete a group | Right-click the group node in the tree |
| Open picks folder | `AI Toolkit: Open My Picks Folder` |

Picks are stored as symlinks (or copies as a fallback) under `~/.ai-toolkits/my-picks/` and are registered as a synthetic toolkit so Copilot discovers them automatically.

---

## Adding Your Own Folders

You can point the extension at any folder that contains Copilot asset subfolders (`agents/`, `instructions/`, `skills/`, etc.).

1. Click **+** in the sidebar toolbar → **Add Toolkit Folder**
2. Browse to your folder
3. The extension scans it and adds it to the tree

To remove a folder right-click the toolkit → **Remove Toolkit Folder**.

---

## Supported Asset Types

| Type | File pattern | Copilot setting configured |
|------|-------------|---------------------------|
| Agents | `*.agent.md` | `chat.agentFilesLocations` |
| Instructions | `*.instructions.md` | `chat.instructionsFilesLocations`, `codeGeneration.instructions` |
| Skills | folder with `SKILL.md` | `chat.agentSkillsLocations` |
| Prompts | `*.prompt.md` | `chat.promptFilesLocations` |
| Hooks | folder | `chat.hookFilesLocations` |
| Plugins | folder | (workspace folder registration) |
| Workflows | `*.md` | (workspace folder registration) |
| Standards | folder | (workspace folder registration) |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `aiToolkit.toolkitPaths` | `[]` | Folders to scan for toolkits |
| `aiToolkit.cloneDirectory` | `~/.ai-toolkits` | Where cloned repos are stored |
| `aiToolkit.picksDirectory` | `~/.ai-toolkits/my-picks` | Where pinned assets are linked |
| `aiToolkit.configureCopilotSettings` | `true` | Auto-update Copilot settings on enable/disable |
| `aiToolkit.checkForUpdatesOnStartup` | `true` | Check for updates shortly after VS Code starts |
| `aiToolkit.updateCheckIntervalMinutes` | `0` | Periodic update interval in minutes (0 = disabled, minimum 5) |

---

## Command Reference

| Command | Description |
|---------|-------------|
| `AI Toolkit: Add Toolkit Folder` | Browse for a local toolkit folder |
| `AI Toolkit: Clone Toolkit from GitHub…` | Clone a GitHub repo into the clone directory |
| `AI Toolkit: Enable Toolkit` | Enable a toolkit and update Copilot settings |
| `AI Toolkit: Disable Toolkit` | Disable a toolkit and remove its Copilot entries |
| `AI Toolkit: Enable All Toolkits` | Enable everything |
| `AI Toolkit: Disable All Toolkits` | Disable everything and clean managed settings |
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
| `AI Toolkit: Open My Picks Folder` | Reveal the picks directory in the OS file explorer |
| `AI Toolkit: Add to Workspace` | Add a toolkit folder to the workspace (for plugin/workflow discovery) |
| `AI Toolkit: Remove from Workspace` | Remove a toolkit folder from the workspace |

---

## Troubleshooting

**Copilot isn't picking up my assets after enabling a toolkit**
Open VS Code settings (`Ctrl+,`) and search for `chat.agentFilesLocations` — the toolkit's asset folders should appear. If they don't, try `AI Toolkit: Refresh Toolkits` and check the **AI Toolkit** output channel for errors.

**Clone fails with an authentication error**
The extension uses your system git config for credentials. Run `git clone <url>` in a terminal first to trigger your credential helper, then retry the clone in the extension.

**Symlinks not working on Windows**
Windows requires Developer Mode or administrator rights to create symlinks. If neither is available, the extension automatically falls back to full file copies, which work identically from Copilot's perspective.

**An asset I pinned isn't showing up**
Run `AI Toolkit: Refresh Toolkits`. If the source file was moved or deleted, the extension will prune the stale pin automatically.

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
