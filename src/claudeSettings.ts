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
    if (current === null) {
      this.log.appendLine('[AI Toolkit / Claude] Skipping hooks/MCP update — settings.json is malformed');
      return;
    }

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

    // Manage enabledPlugins: remove old managed keys, add new ones.
    // Preserves any user-defined plugin entries.
    const enabledPlugins: Record<string, boolean> =
      (current.enabledPlugins && typeof current.enabledPlugins === 'object')
        ? { ...(current.enabledPlugins as Record<string, boolean>) }
        : {};
    for (const key of oldPluginKeys) { delete enabledPlugins[key]; }
    for (const key of newPluginKeys) { enabledPlugins[key] = true; }
    if (Object.keys(enabledPlugins).length === 0) {
      delete current.enabledPlugins;
    } else {
      current.enabledPlugins = enabledPlugins;
    }

    const newHookCommands: string[] = [];
    const newMcpKeys: string[] = [];

    for (const toolkit of toolkits) {
      const tkName = this.pluginName(toolkit);

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

      const tkName = this.pluginName(toolkit);
      // Plugin directory is a direct child of pluginsRoot so that installPath
      // is a direct child of installLocation — Claude Code validates this relationship.
      const pluginDir = path.join(pluginsRoot, tkName);
      const skillsDir = path.join(pluginDir, 'skills');

      await fs.promises.mkdir(skillsDir, { recursive: true });

      // Claude Code identifies plugins by package.json at the plugin root.
      await this.writeJsonAtomic(
        path.join(pluginDir, 'package.json'),
        {
          name: tkName,
          version: '1.0.0',
          description: `AI Toolkit managed: ${toolkit.name}`,
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

    // Ensure ai-toolkit marketplace is registered (always, even when newPluginKeys is empty,
    // so that disabling all toolkits still writes a valid marketplace.json).
    await this.ensureMarketplaceRegistered(registryDir, pluginsRoot, newPluginKeys);

    await this.setManagedState({
      ...managed,
      managedPluginPaths: newPluginPaths,
      managedPluginKeys: newPluginKeys,
    });
    this.log.appendLine(`[AI Toolkit / Claude] Registered ${newPluginKeys.length} plugin(s), ${newPluginPaths.length} skill link(s)`);

    return newPluginKeys;
  }

  private async ensureMarketplaceRegistered(registryDir: string, pluginsRoot: string, pluginKeys: string[]): Promise<void> {
    // Claude Code expects a .claude-plugin/marketplace.json descriptor inside the
    // marketplace root directory (pluginsRoot). Name must be kebab-case (no spaces),
    // and plugins must be an array.
    const marketplaceMetaDir = path.join(pluginsRoot, '.claude-plugin');
    const marketplaceJsonPath = path.join(marketplaceMetaDir, 'marketplace.json');
    await fs.promises.mkdir(marketplaceMetaDir, { recursive: true });
    // Strip @ai-toolkit suffix to get bare plugin names.
    // path field is relative to the marketplace root (pluginsRoot), matching
    // how claude-plugins-official stores plugins under its installLocation/plugins/ dir.
    const pluginNames = pluginKeys.map(k => k.replace(/@ai-toolkit$/, ''));
    await this.writeJsonAtomic(marketplaceJsonPath, {
      id: 'ai-toolkit',
      name: 'ai-toolkit',
      description: 'Skills and plugins managed by the AI Toolkit VS Code extension',
      version: '1.0.0',
      owner: { name: 'AI Toolkit' },
      plugins: pluginNames.map(name => ({ name, path: name })),
    });

    // Register the marketplace in Claude Code's known_marketplaces.json so it
    // knows where to find it.
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

  /**
   * Derives a filesystem-safe, collision-resistant plugin name from the toolkit.
   * toolkit.id is a tilde-relative path like ~/work/company/my-toolkit.
   * Stripping the tilde prefix and replacing separators gives "work-company-my-toolkit",
   * which is unique across toolkits with the same folder name in different parent paths.
   * Falls back to path.basename when id is not tilde-relative (e.g. in tests).
   */
  private pluginName(toolkit: Toolkit): string {
    // Use the toolkit's display name, sanitized for filesystem and plugin key use.
    // toolkit.name is already the folder basename or manifest name — much shorter
    // and more readable than building a name from the full tilde-relative path.
    return toolkit.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '_')
      || path.basename(toolkit.rootPath).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  }
}
