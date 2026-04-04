# AI Toolkit

A VS Code extension for managing AI toolkits from external folders. Browse, enable, and disable Copilot agents, instructions, skills, prompts, and plugins across workspaces.

Works with:
- [awesome-copilot](https://github.com/github/awesome-copilot) community assets
- [CopilotCustomizer](https://github.com/klintravis/CopilotCustomizer) generated assets
- Any folder following standard Copilot asset conventions

## Features

- **External toolkit management** — point to folders outside your repo containing AI assets
- **Auto-discovery** — scans for agents, instructions, skills, prompts, plugins, hooks, workflows, and standards
- **Enable/disable** — toggle individual toolkits on or off per workspace
- **Sync to workspace** — enabled assets are symlinked (or copied) into your workspace's `.github/` directory
- **Sidebar TreeView** — browse all discovered toolkits and assets from the activity bar
- **Format detection** — recognizes both awesome-copilot (top-level) and CopilotCustomizer (`.github/`) layouts

## Getting Started

### Install from source

```bash
git clone https://github.com/klintravis/ai-toolkit.git
cd ai-toolkit
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

### Add toolkit folders

1. Open the **AI Toolkit** panel in the activity bar
2. Click the `+` button to add a folder (e.g., a cloned `awesome-copilot` repo or a `CopilotCustomizer` output directory)
3. Discovered toolkits appear in the tree view

### Enable a toolkit

Click the enable icon next to a toolkit in the sidebar. Its assets will be synced into your workspace's `.github/` directory (agents, instructions, skills, etc.).

## Settings

| Setting | Default | Description |
|---|---|---|
| `aiToolkit.toolkitPaths` | `[]` | Folders to scan for AI toolkits |
| `aiToolkit.enabledToolkits` | `{}` | Map of toolkit IDs to enabled/disabled state |
| `aiToolkit.targetDirectory` | `.github` | Workspace-relative directory for synced assets |
| `aiToolkit.syncMethod` | `symlink` | How to sync assets: `symlink` or `copy` |
| `aiToolkit.autoSync` | `true` | Automatically sync when toolkits are toggled |

## Commands

| Command | Description |
|---|---|
| `AI Toolkit: Add Toolkit Folder` | Browse for a folder to add |
| `AI Toolkit: Remove Toolkit Folder` | Remove a configured folder |
| `AI Toolkit: Enable Toolkit` | Enable a toolkit for the current workspace |
| `AI Toolkit: Disable Toolkit` | Disable a toolkit |
| `AI Toolkit: Enable All Toolkits` | Enable all discovered toolkits |
| `AI Toolkit: Disable All Toolkits` | Disable all toolkits and clean synced assets |
| `AI Toolkit: Refresh Toolkits` | Re-scan all configured folders |
| `AI Toolkit: Open Asset` | Open an asset file in the editor |

## Supported Asset Types

| Type | File Pattern | Folder-based |
|---|---|---|
| Agents | `*.agent.md` | No |
| Instructions | `*.instructions.md` | No |
| Skills | `*/SKILL.md` | Yes |
| Prompts | `*.prompt.md` | No |
| Plugins | `*/plugin.md` | Yes |
| Hooks | `*/` | Yes |
| Workflows | `*.md` | No |
| Standards | `*/` | Yes |

## How Syncing Works

When you enable a toolkit, AI Toolkit syncs its assets into your workspace:

- **Symlink mode** (default): Creates symbolic links from your workspace `.github/` to the source files. Changes to the source are immediately reflected.
- **Copy mode**: Copies files into `.github/`. Use this if symlinks aren't supported.

A `.ai-toolkit-manifest.json` file tracks which assets are managed by the extension, so it never overwrites your own files.

## Architecture

```
src/
  extension.ts       — Entry point, command registration
  types.ts           — Asset types, toolkit interfaces, constants
  scanner.ts         — Discovers toolkits and assets from folders
  toolkitManager.ts  — Syncs enabled assets into workspace
  treeProvider.ts    — Sidebar TreeView for browsing toolkits
```

## License

MIT
