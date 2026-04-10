# Claude Code Integration

This document explains how the AI Toolkit VS Code extension registers Claude Code assets — skills, hooks, and MCP servers — from a toolkit repo into Claude Code's configuration files.

---

## Overview

When you enable a toolkit that contains Claude-side assets, the extension writes to two locations on disk:

| Location | What is written |
|---|---|
| `~/.claude/settings.json` | Hook handlers, MCP server definitions, enabled plugin keys |
| `~/.claude/plugins/` | Plugin registry (`installed_plugins.json`, `known_marketplaces.json`) |
| `~/.ai-toolkits/claude-plugins/` | Materialized plugin directories with symlinked skill folders |

All paths are configurable — see [Settings](#settings).

---

## Skills (`claude/skills/`)

Skills are the most involved asset type because they need to be registered with both Copilot and Claude Code.

### What a skill folder looks like

```
claude/skills/
  run-tests/
    SKILL.md          # required — human-readable description
    run.sh            # support files
  code-review/
    SKILL.md
    review.py
```

Each subfolder is one skill. The `SKILL.md` file is the documentation for the skill.

### How the extension registers skills

For each enabled toolkit that has a `claude/skills/` folder, the extension:

1. **Creates a plugin directory** under `~/.ai-toolkits/claude-plugins/<toolkit-name>/`

2. **Writes a `.claude-plugin/plugin.json`** metadata file inside the plugin directory:
   ```json
   {
     "name": "<toolkit-name>",
     "version": "1.0.0",
     "marketplace": "ai-toolkit",
     "skills": ["run-tests", "code-review"]
   }
   ```

3. **Creates `skills/<skill-name>/` symlinks** inside the plugin directory, each pointing to the corresponding subfolder in the toolkit:
   ```
   ~/.ai-toolkits/claude-plugins/my-toolkit/
     .claude-plugin/
       plugin.json
     skills/
       run-tests  →  ~/.ai-toolkits/my-toolkit/claude/skills/run-tests
       code-review →  ~/.ai-toolkits/my-toolkit/claude/skills/code-review
   ```
   Symlinks mean that when the toolkit is updated with a git pull, the skill files are immediately live in Claude Code — no re-sync needed. On Windows without Developer Mode, the extension falls back to full directory copies and re-syncs them after each pull.

4. **Registers the plugin** in `~/.claude/plugins/installed_plugins.json`:
   ```json
   {
     "my-toolkit@ai-toolkit": {
       "path": "/home/user/.ai-toolkits/claude-plugins/my-toolkit",
       "enabled": true
     }
   }
   ```

5. **Registers the marketplace** in `~/.claude/plugins/known_marketplaces.json`:
   ```json
   {
     "ai-toolkit": {
       "name": "AI Toolkit",
       "url": "vscode:extension/klintravis.ai-toolkit"
     }
   }
   ```

6. **Enables the plugin key** in `~/.claude/settings.json` under the appropriate plugins section.

### Skills also register with Copilot

Because `claude/skills/` has `platform: "both"` in the asset mappings, the skill folder path is also written to `chat.agentSkillsLocations` in VS Code User-level settings so Copilot discovers the same skills.

---

## Hooks (`claude/hooks/`)

Each `.json` file in `claude/hooks/` describes one Claude Code hook handler.

### Hook file format

```json
{
  "event": "PreToolUse",
  "matcher": "Bash",
  "command": "./scripts/safety-check.sh"
}
```

| Field | Required | Values |
|---|---|---|
| `event` | yes | `PreToolUse`, `PostToolUse`, `Notification`, `Stop` |
| `matcher` | no | Tool name or glob pattern to match (omit to match all) |
| `command` | yes | Shell command — relative paths resolved from toolkit root |

### How the extension registers hooks

The `command` field supports paths relative to the toolkit root (e.g. `"./scripts/check.sh"`). Before writing to `~/.claude/settings.json`, the extension resolves relative paths to absolute paths:

```
./scripts/safety-check.sh
→ /home/user/.ai-toolkits/my-toolkit/scripts/safety-check.sh
```

The hook is written to `~/.claude/settings.json` under the `hooks` key:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/.ai-toolkits/my-toolkit/scripts/safety-check.sh"
          }
        ]
      }
    ]
  }
}
```

Multiple toolkits can contribute hooks to the same event. The extension appends to existing hook arrays rather than replacing them, and removes only the entries it owns when the toolkit is disabled.

### Hook script requirements

- The script must be executable (`chmod +x` on Unix)
- The script receives context from Claude Code via stdin or environment variables (see Claude Code documentation)
- The script's working directory when invoked by Claude Code is the project root, not the toolkit directory — use the absolute path the extension writes, not relative paths inside your script

---

## MCP Servers (`claude/mcps/`)

Each `.json` file in `claude/mcps/` describes one MCP (Model Context Protocol) server that Claude Code should start.

### MCP server file format

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": ""
  }
}
```

| Field | Required | Description |
|---|---|---|
| `name` | yes | Display name for the server |
| `command` | yes | Executable to run (must be on PATH or absolute) |
| `args` | no | Arguments array |
| `env` | no | Environment variables to set for the server process |

### How the extension registers MCP servers

Each server is written to `~/.claude/settings.json` under `mcpServers` with a namespaced key:

```json
{
  "mcpServers": {
    "my-toolkit__github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": ""
      }
    }
  }
}
```

The key format is `<toolkit-name>__<server-name>` (double underscore). This namespacing prevents collisions between servers from different toolkits.

When the toolkit is disabled, the extension removes only the keys it owns from `mcpServers` — servers added by other means are untouched.

### Credentials in MCP server configs

Do not hardcode credentials in `.json` files that are committed to git. Use empty string placeholders and document what value the team member needs to supply:

```json
{
  "name": "jira",
  "command": "node",
  "args": ["./server.js"],
  "env": {
    "JIRA_BASE_URL": "",
    "JIRA_API_TOKEN": ""
  }
}
```

Team members can set these as environment variables in their shell profile so Claude Code picks them up, or they can edit their local `~/.claude/settings.json` after the extension writes the entry.

---

## Settings

All paths used by the Claude Code integration are configurable in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `aiToolkit.claudeSettingsPath` | `~/.claude/settings.json` | Path to Claude Code's settings file |
| `aiToolkit.claudePluginsPath` | `~/.ai-toolkits/claude-plugins` | Where plugin directories are materialized |
| `aiToolkit.claudePluginsRegistryPath` | `~/.claude/plugins` | Claude Code plugin registry directory |
| `aiToolkit.configureCopilotSettings` | `true` | When false, no settings are written to either Copilot or Claude Code |

Paths support `~/` tilde notation and are expanded to the user's home directory at runtime.

---

## How Enable/Disable Works

When you **enable** a toolkit:
1. Skills: plugin directory is materialized, plugin registry entries are written, plugin key is enabled in `~/.claude/settings.json`
2. Hooks: hook entries are appended to `~/.claude/settings.json`
3. MCP servers: server entries are written to `~/.claude/settings.json`

When you **disable** a toolkit:
1. Skills: plugin key is removed from `~/.claude/settings.json` (plugin directory and registry entries are left in place for quick re-enable)
2. Hooks: hook entries owned by this toolkit are removed from `~/.claude/settings.json`
3. MCP servers: server entries owned by this toolkit are removed from `~/.claude/settings.json`

The extension tracks which entries it owns using the namespaced key prefix so it never removes entries created by other tools or by the user directly.

---

## Troubleshooting

**Skills are not showing up in Claude Code**

1. Confirm the toolkit is enabled (checkmark visible in the AI Toolkits tree)
2. Check that `~/.claude/plugins/installed_plugins.json` contains an entry for `<toolkit-name>@ai-toolkit`
3. Check that `~/.claude/settings.json` has the plugin key enabled
4. Run `AI Toolkit: Refresh Toolkits` to force a re-write of all settings
5. Restart Claude Code — some changes require a restart to take effect

**Hooks are not running**

1. Verify the hook JSON file is valid (check the AI Toolkit output channel for parse errors)
2. Confirm the script file exists at the resolved absolute path in `~/.claude/settings.json`
3. On Unix, check the script is executable: `ls -l /path/to/script.sh` should show `x` bits
4. Check Claude Code's own output for hook execution errors

**MCP server fails to start**

1. Confirm the `command` is on your PATH: run `which <command>` in a terminal
2. For `npx`-based servers, ensure Node.js is installed and `npx` works in a non-interactive shell
3. Check that any required `env` values are set in the environment Claude Code is launched from
4. Look at Claude Code's MCP server logs for the specific error

**Settings file is not being updated**

If `aiToolkit.configureCopilotSettings` is `false`, the extension will scan and display toolkits but will not write any settings. Set it to `true` to re-enable automatic configuration.
