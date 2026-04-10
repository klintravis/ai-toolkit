import * as fs from 'fs';
import * as path from 'path';
import { expandHomePath } from './pathUtils';
import { AssetType, GlobalStateContext, OutputLog, Toolkit } from './types';

const MANAGED_STATE_KEY = 'aiToolkit.claudeManagedEntries';

interface ClaudeManagedState {
  managedMcpKeys: string[];
  managedHookCommands: string[];
  managedPluginPaths: string[];
  managedPluginKeys: string[];
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
    private getPluginsRegistryPath: () => string,
  ) {}

  async applyToolkits(toolkits: Toolkit[]): Promise<void> {
    const enabled = toolkits.filter(t => t.enabled);
    const oldPluginKeys = this.getManagedState().managedPluginKeys ?? [];
    const newPluginKeys = await this.applySkillPlugins(enabled);
    await this.applyHooksAndMcps(enabled, oldPluginKeys, newPluginKeys);
  }

  private async applyHooksAndMcps(toolkits: Toolkit[], oldPluginKeys: string[], newPluginKeys: string[]): Promise<void> {
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

    // Manage enabledPlugins: remove old managed plugin keys, add new ones
    if (!current.enabledPlugins || typeof current.enabledPlugins !== 'object') {
      current.enabledPlugins = {};
    }
    const enabledPlugins = current.enabledPlugins as Record<string, boolean>;
    for (const key of oldPluginKeys) {
      delete enabledPlugins[key];
    }
    for (const key of newPluginKeys) {
      enabledPlugins[key] = true;
    }
    if (Object.keys(enabledPlugins).length === 0) {
      delete current.enabledPlugins;
    } else {
      current.enabledPlugins = enabledPlugins;
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

  private async applySkillPlugins(toolkits: Toolkit[]): Promise<string[]> {
    const pluginsRoot = expandHomePath(this.getPluginsPath());
    const registryDir = expandHomePath(this.getPluginsRegistryPath());
    const managed = this.getManagedState();

    // Remove previously-managed skill links
    for (const linkPath of managed.managedPluginPaths) {
      try {
        await fs.promises.rm(linkPath, { recursive: true, force: true });
      } catch { /* already gone */ }
    }

    // Remove previously-managed plugin registrations
    if ((managed.managedPluginKeys ?? []).length > 0) {
      await this.removeFromInstalledPlugins(managed.managedPluginKeys, registryDir);
    }

    const newPluginPaths: string[] = [];
    const newPluginKeys: string[] = [];

    for (const toolkit of toolkits) {
      const skillAssets = toolkit.assets.filter(
        a => a.type === AssetType.Skill && (a.platform === 'both' || a.platform === 'claude') && a.isFolder
      );
      if (skillAssets.length === 0) continue;

      const tkName = path.basename(toolkit.rootPath);
      const pluginDir = path.join(pluginsRoot, tkName);
      const skillsDir = path.join(pluginDir, 'skills');
      const claudePluginMetaDir = path.join(pluginDir, '.claude-plugin');

      await fs.promises.mkdir(skillsDir, { recursive: true });
      await fs.promises.mkdir(claudePluginMetaDir, { recursive: true });

      // Write .claude-plugin/plugin.json
      await this.writeJsonAtomic(
        path.join(claudePluginMetaDir, 'plugin.json'),
        {
          name: tkName,
          description: `AI Toolkit managed: ${toolkit.name}`,
          version: 'managed',
          author: { name: 'ai-toolkit' },
          keywords: ['skills', 'ai-toolkit'],
        }
      );

      // Symlink each skill
      for (const skillAsset of skillAssets) {
        const linkPath = path.join(skillsDir, path.basename(skillAsset.sourcePath));
        try {
          await fs.promises.symlink(
            skillAsset.sourcePath, linkPath,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
          newPluginPaths.push(linkPath);
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
            this.log.appendLine(`[AI Toolkit / Claude] Could not link skill ${skillAsset.name}: ${err}`);
          } else {
            newPluginPaths.push(linkPath);
          }
        }
      }

      // Register in installed_plugins.json
      const pluginKey = `${tkName}@ai-toolkit`;
      await this.registerInInstalledPlugins(pluginKey, pluginDir, registryDir);
      newPluginKeys.push(pluginKey);
    }

    // Ensure ai-toolkit marketplace is registered
    if (newPluginKeys.length > 0) {
      await this.ensureMarketplaceRegistered(registryDir, pluginsRoot);
    }

    await this.setManagedState({
      ...managed,
      managedPluginPaths: newPluginPaths,
      managedPluginKeys: newPluginKeys,
    });
    this.log.appendLine(`[AI Toolkit / Claude] Registered ${newPluginKeys.length} plugin(s), ${newPluginPaths.length} skill link(s)`);

    return newPluginKeys;
  }

  private async ensureMarketplaceRegistered(registryDir: string, pluginsRoot: string): Promise<void> {
    const marketplacesPath = path.join(registryDir, 'known_marketplaces.json');
    let marketplaces: Record<string, unknown> = {};
    try {
      const content = await fs.promises.readFile(marketplacesPath, 'utf-8');
      marketplaces = JSON.parse(content);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.appendLine(`[AI Toolkit / Claude] Could not read known_marketplaces.json: ${err}`);
        return;
      }
    }

    if (!marketplaces['ai-toolkit']) {
      marketplaces['ai-toolkit'] = {
        source: { source: 'directory', path: pluginsRoot },
        installLocation: pluginsRoot,
        lastUpdated: new Date().toISOString(),
      };
      await this.writeJsonAtomic(marketplacesPath, marketplaces);
      this.log.appendLine('[AI Toolkit / Claude] Registered ai-toolkit marketplace');
    }
  }

  private async registerInInstalledPlugins(pluginKey: string, installPath: string, registryDir: string): Promise<void> {
    const installedPath = path.join(registryDir, 'installed_plugins.json');
    let registry: { version: number; plugins: Record<string, unknown[]> } = { version: 2, plugins: {} };
    try {
      const content = await fs.promises.readFile(installedPath, 'utf-8');
      registry = JSON.parse(content);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.appendLine(`[AI Toolkit / Claude] Could not read installed_plugins.json: ${err}`);
        return;
      }
    }

    if (!registry.plugins) registry.plugins = {};
    registry.plugins[pluginKey] = [{
      scope: 'user',
      installPath,
      version: 'managed',
      installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    }];

    await this.writeJsonAtomic(installedPath, registry);
  }

  private async removeFromInstalledPlugins(pluginKeys: string[], registryDir: string): Promise<void> {
    if (pluginKeys.length === 0) return;
    const installedPath = path.join(registryDir, 'installed_plugins.json');
    try {
      const content = await fs.promises.readFile(installedPath, 'utf-8');
      const registry = JSON.parse(content) as { version: number; plugins: Record<string, unknown> };
      for (const key of pluginKeys) {
        delete registry.plugins?.[key];
      }
      await this.writeJsonAtomic(installedPath, registry);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.appendLine(`[AI Toolkit / Claude] Could not update installed_plugins.json: ${err}`);
      }
    }
  }

  private async writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.ai-toolkit-tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    try {
      await fs.promises.rename(tmp, filePath);
    } catch (err) {
      await fs.promises.unlink(tmp).catch(() => undefined);
      throw err;
    }
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
    await this.writeJsonAtomic(settingsPath, settings);
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as T;
    } catch { return null; }
  }

  private getManagedState(): ClaudeManagedState {
    return this.context.globalState.get<ClaudeManagedState>(MANAGED_STATE_KEY) ?? {
      managedMcpKeys: [], managedHookCommands: [], managedPluginPaths: [], managedPluginKeys: [],
    };
  }

  private async setManagedState(state: ClaudeManagedState): Promise<void> {
    await this.context.globalState.update(MANAGED_STATE_KEY, state);
  }
}
