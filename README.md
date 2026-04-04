# AI Toolkit

A VS Code extension for managing AI toolkits from external folders. Browse, enable, and disable Copilot agents, instructions, skills, prompts, and plugins — shared across all your workspaces.

Works with:
- [awesome-copilot](https://github.com/github/awesome-copilot) community assets
- [CopilotCustomizer](https://github.com/klintravis/CopilotCustomizer) generated assets
- Any folder following standard Copilot asset conventions

## How It Works

Toolkits live in **external folders** on your machine (e.g., a cloned CopilotCustomizer repo). When you enable a toolkit, the extension configures your VS Code **User-level settings** so GitHub Copilot discovers the assets directly from where they already are — no files are copied or synlinked into your workspace.

This means:
- **One copy** of your toolkits serves all workspaces
- **Enable/disable** globally from the sidebar
- **Copilot settings** are updated automatically (`github.copilot.chat.codeGeneration.instructions`, `chat.instructionsFilesLocations`, `chat.agentFilesLocations`, `chat.promptFilesLocations`, `chat.agentSkillsLocations`, `chat.hookFilesLocations`)

When a toolkit lives under your home directory, the extension writes Copilot discovery locations as `~/...` paths so VS Code accepts them on all platforms. If a toolkit lives outside your home directory, you can still add it as a **workspace folder** via right-click so Copilot discovers its `.github/` content from the workspace.

## Getting Started

### Install from source

```bash
git clone https://github.com/klintravis/ai-toolkit.git
cd ai-toolkit
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

### Example: Add CopilotCustomizer

1. Clone CopilotCustomizer to a permanent location:
   ```bash
   git clone https://github.com/klintravis/CopilotCustomizer ~/toolkits/CopilotCustomizer
   ```
2. Open the **AI Toolkit** panel in the VS Code activity bar
3. Click `+` and select `~/toolkits/CopilotCustomizer`
4. The extension discovers all assets (agents, instructions, skills, prompts, standards)
5. Click the enable icon next to the toolkit
6. Copilot immediately picks up the assets — no restart needed

### Example: Add awesome-copilot

```bash
git clone https://github.com/github/awesome-copilot ~/toolkits/awesome-copilot
```

Then add `~/toolkits/awesome-copilot` in the AI Toolkit sidebar. Its 187 agents, 175 instructions, 271 skills, and 57 plugins are all discoverable.

## What Happens When You Enable a Toolkit

The extension updates your **VS Code User settings** (global, not per-workspace):

1. **Feature flags** — enables `github.copilot.chat.codeGeneration.useInstructionFiles`, `chat.useAgentSkills`, `chat.useHooks`
2. **Code generation instructions** — adds entries to `github.copilot.chat.codeGeneration.instructions` with absolute file paths pointing at the toolkit's instruction files
3. **Discovery locations** — adds the toolkit's `instructions/`, `agents/`, `prompts/`, `skills/`, and `hooks/` folders to the corresponding `chat.*Locations` settings using `~/...` paths when supported so Copilot can discover them directly from the external toolkit path

For workflows, plugins, standards, or any toolkit content you also want present as an actual workspace folder, you can still right-click a toolkit and select **"Add to Workspace"**.

## Settings

| Setting | Default | Description |
|---|---|---|
| `aiToolkit.toolkitPaths` | `[]` | Folders to scan for AI toolkits |
| `aiToolkit.enabledToolkits` | `{}` | Map of toolkit IDs to enabled/disabled (stored globally) |
| `aiToolkit.configureCopilotSettings` | `true` | Auto-configure Copilot settings when toolkits are toggled |

## Commands

| Command | Description |
|---|---|
| `AI Toolkit: Add Toolkit Folder` | Browse for a folder containing AI assets |
| `AI Toolkit: Remove Toolkit Folder` | Remove a configured folder |
| `AI Toolkit: Enable Toolkit` | Enable a toolkit globally |
| `AI Toolkit: Disable Toolkit` | Disable a toolkit globally |
| `AI Toolkit: Enable All Toolkits` | Enable all discovered toolkits |
| `AI Toolkit: Disable All Toolkits` | Disable all and clean managed settings |
| `AI Toolkit: Add to Workspace` | Add toolkit folder to workspace for full Copilot discovery |
| `AI Toolkit: Remove from Workspace` | Remove toolkit from workspace folders |
| `AI Toolkit: Refresh Toolkits` | Re-scan all configured folders |
| `AI Toolkit: Open Asset` | Open an asset file in the editor |

## Supported Asset Types

| Type | File Pattern | Source |
|---|---|---|
| Agents | `*.agent.md` | awesome-copilot, CopilotCustomizer |
| Instructions | `*.instructions.md` | awesome-copilot, CopilotCustomizer |
| Skills | `*/SKILL.md` | awesome-copilot, CopilotCustomizer |
| Prompts | `*.prompt.md` | CopilotCustomizer |
| Plugins | `*/plugin.md` | awesome-copilot |
| Hooks | `*/` | awesome-copilot, CopilotCustomizer |
| Workflows | `*.md` | awesome-copilot |
| Standards | `*/` | CopilotCustomizer |

## Architecture

```
src/
  extension.ts        — Entry point, command registration, global state
  types.ts            — Asset types, toolkit interfaces, constants
  scanner.ts          — Discovers toolkits and assets from external folders
  copilotSettings.ts  — Configures VS Code Copilot settings (User-level)
  treeProvider.ts     — Sidebar TreeView for browsing toolkits
```

No files are copied into your workspace. All configuration is done via VS Code settings pointing at the external toolkit folders.

## License

MIT
