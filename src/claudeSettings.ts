import * as fs from 'fs';
import * as path from 'path';
import { expandHomePath } from './pathUtils';
import { AssetType, GlobalStateContext, OutputLog, Toolkit } from './types';

const MANAGED_STATE_KEY = 'aiToolkit.claudeManagedEntries';

interface ClaudeManagedState {
  managedMcpKeys: string[];
  managedHookCommands: string[];
  managedPluginPaths: string[];
}

interface ClaudeSettings {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  [key: string]: unknown;
}

interface HookFile { event: string; matcher?: string; command: string; }
interface McpFile { name: string; command: string; args?: string[]; env?: Record<string, string>; }

export class ClaudeSettingsManager {
  constructor(
    private context: GlobalStateContext,
    private log: OutputLog,
    private getSettingsPath: () => string,
    private getPluginsPath: () => string,
  ) {}

  async applyToolkits(toolkits: Toolkit[]): Promise<void> {
    const enabled = toolkits.filter(t => t.enabled);
    await this.applyHooksAndMcps(enabled);
    await this.applySkillPlugins(enabled);
  }

  private async applyHooksAndMcps(toolkits: Toolkit[]): Promise<void> {
    const settingsPath = expandHomePath(this.getSettingsPath());
    const current = await this.readSettings(settingsPath);
    if (current === null) return;

    const managed = this.getManagedState();

    // Remove previously-managed hooks
    if (current.hooks) {
      for (const event of Object.keys(current.hooks)) {
        current.hooks[event] = (current.hooks[event] ?? []).filter(group => {
          const cmd = group.hooks?.[0]?.command;
          return !cmd || !managed.managedHookCommands.includes(cmd);
        });
        if (current.hooks[event].length === 0) delete current.hooks[event];
      }
      if (Object.keys(current.hooks).length === 0) delete current.hooks;
    }

    // Remove previously-managed MCPs
    for (const key of managed.managedMcpKeys) {
      delete current.mcpServers?.[key];
    }
    if (current.mcpServers && Object.keys(current.mcpServers).length === 0) {
      delete current.mcpServers;
    }

    const newHookCommands: string[] = [];
    const newMcpKeys: string[] = [];

    for (const toolkit of toolkits) {
      const tkName = path.basename(toolkit.rootPath);

      for (const asset of toolkit.assets) {
        if (asset.type === AssetType.Hook && (asset.platform === 'claude' || asset.platform === 'both') && !asset.isFolder) {
          const hookContent = await this.readJson<HookFile>(asset.sourcePath);
          if (!hookContent?.event || !hookContent?.command) continue;
          const absCmd = path.isAbsolute(hookContent.command)
            ? hookContent.command
            : path.join(toolkit.rootPath, hookContent.command);
          if (!current.hooks) current.hooks = {};
          if (!current.hooks[hookContent.event]) current.hooks[hookContent.event] = [];
          const entry: { matcher?: string; hooks: Array<{ type: string; command: string }> } = {
            hooks: [{ type: 'command', command: absCmd }],
          };
          if (hookContent.matcher) entry.matcher = hookContent.matcher;
          current.hooks[hookContent.event].push(entry);
          newHookCommands.push(absCmd);
        }

        if (asset.type === AssetType.McpServer && (asset.platform === 'claude' || asset.platform === 'both') && !asset.isFolder) {
          const mcpContent = await this.readJson<McpFile>(asset.sourcePath);
          if (!mcpContent?.name || !mcpContent?.command) continue;
          const key = `${tkName}__${mcpContent.name}`;
          const resolvedArgs = (mcpContent.args ?? []).map(arg =>
            path.isAbsolute(arg) ? arg : path.resolve(toolkit.rootPath, arg)
          );
          if (!current.mcpServers) current.mcpServers = {};
          current.mcpServers[key] = {
            command: mcpContent.command,
            ...(resolvedArgs.length > 0 ? { args: resolvedArgs } : {}),
            ...(mcpContent.env && Object.keys(mcpContent.env).length > 0 ? { env: mcpContent.env } : {}),
          };
          newMcpKeys.push(key);
        }
      }
    }

    await this.writeSettings(settingsPath, current);
    await this.setManagedState({ ...managed, managedHookCommands: newHookCommands, managedMcpKeys: newMcpKeys });
    this.log.appendLine(`[AI Toolkit / Claude] Applied ${newHookCommands.length} hook(s), ${newMcpKeys.length} MCP(s)`);
  }

  private async applySkillPlugins(toolkits: Toolkit[]): Promise<void> {
    const pluginsRoot = expandHomePath(this.getPluginsPath());
    const managed = this.getManagedState();

    for (const linkPath of managed.managedPluginPaths) {
      try {
        await fs.promises.rm(linkPath, { recursive: true, force: true });
      } catch { /* already gone */ }
    }

    const newPluginPaths: string[] = [];

    for (const toolkit of toolkits) {
      const skillAssets = toolkit.assets.filter(
        a => a.type === AssetType.Skill && (a.platform === 'both' || a.platform === 'claude') && a.isFolder
      );
      if (skillAssets.length === 0) continue;

      const tkName = path.basename(toolkit.rootPath);
      const pluginDir = path.join(pluginsRoot, tkName);
      const skillsDir = path.join(pluginDir, 'skills');
      await fs.promises.mkdir(skillsDir, { recursive: true });

      for (const skillAsset of skillAssets) {
        const linkPath = path.join(skillsDir, path.basename(skillAsset.sourcePath));
        try {
          await fs.promises.symlink(skillAsset.sourcePath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
          newPluginPaths.push(linkPath);  // track the individual link
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
            this.log.appendLine(`[AI Toolkit / Claude] Could not link skill ${skillAsset.name}: ${err}`);
          } else {
            newPluginPaths.push(linkPath);  // already exists, still track it
          }
        }
      }
    }

    await this.setManagedState({ ...managed, managedPluginPaths: newPluginPaths });
    this.log.appendLine(`[AI Toolkit / Claude] Materialized ${newPluginPaths.length} skill link(s)`);
  }

  private async readSettings(settingsPath: string): Promise<ClaudeSettings | null> {
    try {
      const content = await fs.promises.readFile(settingsPath, 'utf-8');
      return JSON.parse(content) as ClaudeSettings;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      this.log.appendLine(`[AI Toolkit / Claude] settings.json malformed — aborting: ${err}`);
      return null;
    }
  }

  private async writeSettings(settingsPath: string, settings: ClaudeSettings): Promise<void> {
    await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
    const tmp = `${settingsPath}.ai-toolkit-tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
    try {
      await fs.promises.rename(tmp, settingsPath);
    } catch (err) {
      await fs.promises.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as T;
    } catch { return null; }
  }

  private getManagedState(): ClaudeManagedState {
    return this.context.globalState.get<ClaudeManagedState>(MANAGED_STATE_KEY) ?? {
      managedMcpKeys: [], managedHookCommands: [], managedPluginPaths: [],
    };
  }

  private async setManagedState(state: ClaudeManagedState): Promise<void> {
    await this.context.globalState.update(MANAGED_STATE_KEY, state);
  }
}
