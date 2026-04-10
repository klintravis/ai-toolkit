# Authoring Toolkits

This guide explains how to create a toolkit repo that works with the AI Toolkit VS Code extension. A toolkit is just a folder (or a git repo) with a specific directory structure. The extension scans it, discovers assets, and writes the right entries into VS Code User-level settings and `~/.claude/settings.json` automatically.

---

## Folder Layout

The recommended layout is the **DualPlatform** format, which serves both GitHub Copilot and Claude Code from a single repo:

```
my-toolkit/
  ai-toolkit.json           # optional — overrides display name and adds custom mappings
  copilot/
    agents/                 # *.agent.md
    instructions/           # *.instructions.md
    prompts/                # *.prompt.md
    plugins/                # one subfolder per plugin
    hooks/                  # one subfolder per Copilot hook
    workflows/              # *.md
  claude/
    skills/                 # one subfolder per skill (Claude Code + Copilot)
    hooks/                  # *.json hook descriptors
    mcps/                   # *.json MCP server configs
    instructions/           # *.md (Claude Code-specific, planned)
  shared/
    standards/              # one subfolder per standard (tree display only)
    docs/                   # *.md reference docs (tree display only)
```

You do not need every folder. The extension only registers asset types it finds.

---

## Platform Routing

| Folder | Platforms configured |
|---|---|
| `copilot/*` | GitHub Copilot only |
| `claude/skills/` | Both Copilot AND Claude Code |
| `claude/hooks/` | Claude Code only |
| `claude/mcps/` | Claude Code only |
| `claude/instructions/` | Claude Code only (planned) |
| `shared/*` | Tree display only — no settings written |

---

## Asset Types in Detail

### Agents (`copilot/agents/`)

Each `.agent.md` file is one Copilot agent. The folder is registered in `chat.agentFilesLocations`.

```
copilot/agents/
  code-reviewer.agent.md
  sql-expert.agent.md
```

### Instructions (`copilot/instructions/`)

Each `.instructions.md` file is one set of Copilot code-generation instructions. The folder is added to both `chat.instructionsFilesLocations` and `codeGeneration.instructions`.

```
copilot/instructions/
  typescript-style.instructions.md
  security-guidelines.instructions.md
```

### Prompts (`copilot/prompts/`)

Each `.prompt.md` file is one reusable Copilot prompt. The folder is registered in `chat.promptFilesLocations`.

```
copilot/prompts/
  explain-error.prompt.md
  write-tests.prompt.md
```

### Plugins (`copilot/plugins/`)

Each subfolder is one Copilot plugin. The folder is added to the workspace for Copilot discovery.

```
copilot/plugins/
  my-plugin/
    plugin.json
    ...
```

### Copilot Hooks (`copilot/hooks/`)

Each subfolder is one Copilot hook. The folder is registered in `chat.hookFilesLocations`.

### Workflows (`copilot/workflows/`)

Each `.md` file is one Copilot workflow. The folder is added to the workspace for discovery.

### Skills (`claude/skills/`)

Each subfolder is one skill. Skills are registered with **both** Copilot (`chat.agentSkillsLocations`) and Claude Code (via the plugin registry).

Each skill folder should contain a `SKILL.md` file describing what the skill does:

```
claude/skills/
  run-tests/
    SKILL.md
    run-tests.sh
  lint-fix/
    SKILL.md
    fix.sh
```

The `SKILL.md` is the human-readable documentation. Any other files in the folder are support files for the skill.

### Claude Code Hooks (`claude/hooks/`)

Each `.json` file describes one Claude Code hook event handler. The file name (without extension) is used as the hook identifier.

```json
{
  "event": "PreToolUse",
  "matcher": "Bash",
  "command": "./scripts/safety-check.sh"
}
```

**Fields:**

| Field | Required | Description |
|---|---|---|
| `event` | yes | Hook event: `PreToolUse`, `PostToolUse`, `Notification`, `Stop` |
| `matcher` | no | Tool name pattern to match (e.g. `"Bash"`, `"Write"`) |
| `command` | yes | Command to run — relative paths are resolved from the toolkit root |

The `command` path is resolved to an absolute path before being written to `~/.claude/settings.json`. This means commands like `"./scripts/lint.sh"` will point to the correct location regardless of the working directory when Claude Code runs.

```
claude/hooks/
  pre-bash-check.json
  post-write-format.json
```

### MCP Servers (`claude/mcps/`)

Each `.json` file describes one MCP server. The file name (without extension) becomes the server identifier.

```json
{
  "name": "my-server",
  "command": "node",
  "args": ["./server.js"],
  "env": {
    "API_KEY": "..."
  }
}
```

**Fields:**

| Field | Required | Description |
|---|---|---|
| `name` | yes | Display name for the server |
| `command` | yes | Executable to run |
| `args` | no | Arguments array |
| `env` | no | Environment variables |

The server is written to `~/.claude/settings.json` under `mcpServers` with key `<toolkit-name>__<server-name>`.

```
claude/mcps/
  github.json
  jira.json
```

### Standards (`shared/standards/`)

Each subfolder is one standard. Standards appear in the tree but no settings are written — they are reference material for team members browsing the toolkit.

### Docs (`shared/docs/`)

Each `.md` file appears in the tree as a reference document. No settings are written.

---

## Optional Manifest (`ai-toolkit.json`)

Place an `ai-toolkit.json` file at the toolkit root to control how the extension identifies and maps your toolkit:

```json
{
  "name": "My Team Toolkit",
  "mappings": [
    {
      "folder": "custom/templates",
      "assetType": "prompts",
      "platform": "copilot",
      "isFolder": false,
      "extensions": [".prompt.md"]
    }
  ]
}
```

**Top-level fields:**

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name shown in the tree and dashboard |
| `mappings` | array | Extra asset folder mappings beyond the defaults |

**Mapping object fields:**

| Field | Required | Description |
|---|---|---|
| `folder` | yes | Relative path from toolkit root, e.g. `"custom/templates"` |
| `assetType` | yes | Asset type: `agents`, `instructions`, `skills`, `prompts`, `hooks`, `plugins`, `workflows`, `standards`, `docs`, `mcps` |
| `platform` | yes | `"copilot"`, `"claude"`, `"both"`, or `"shared"` |
| `isFolder` | no | `true` if each subdirectory is one asset; `false` to walk for files (default `false`) |
| `extensions` | no | File extensions to match, e.g. `[".agent.md"]` |

Custom mappings are merged with the default mappings — they do not replace them.

---

## Publishing Your Toolkit

A toolkit repo is a plain git repo. To make it cloneable from within the extension:

1. Push the repo to GitHub (public or private)
2. Share the URL or `owner/repo` shorthand with your team
3. Team members clone it via the **Clone** button in the AI Toolkit sidebar

The extension tracks the remote URL and last-known SHA. When you push updates, team members see an update badge and can pull with one click.

### Suggested `README.md` content for your toolkit

Include the following so users know what to expect:

- What platforms the toolkit targets (Copilot, Claude Code, or both)
- A brief description of each agent, skill, and hook
- Any credentials or environment variables required by MCP servers or hook scripts
- Instructions for contributing new assets

---

## Supporting Both awesome-copilot and DualPlatform

The extension also recognises the **awesome-copilot** format (assets at top-level folders like `agents/`, `instructions/`, `skills/`) and the **CopilotCustomizer** format (assets under `.github/`). CopilotCustomizer takes priority when both formats are detected in the same folder.

If you are authoring a new toolkit, the DualPlatform layout is recommended because it is the only format that fully supports Claude Code assets.

---

## Minimal Example

A minimal toolkit with one Copilot agent and one Claude Code skill:

```
team-toolkit/
  ai-toolkit.json
  copilot/
    agents/
      backend-expert.agent.md
  claude/
    skills/
      run-tests/
        SKILL.md
        run.sh
```

`ai-toolkit.json`:
```json
{ "name": "Team Toolkit" }
```

`copilot/agents/backend-expert.agent.md`:
```markdown
---
name: Backend Expert
description: Assists with backend API design and implementation.
---

You are a backend engineering expert...
```

`claude/skills/run-tests/SKILL.md`:
```markdown
# run-tests

Runs the project test suite and reports failures.
```

`claude/skills/run-tests/run.sh`:
```bash
#!/bin/bash
npm test
```
