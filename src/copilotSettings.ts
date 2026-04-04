import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AssetType, Toolkit } from './types';

const DISCOVERY_LOCATION_SETTINGS: Array<{ assetType: AssetType; key: string; label: string }> = [
  { assetType: AssetType.Instruction, key: 'instructionsFilesLocations', label: 'instruction file locations' },
  { assetType: AssetType.Prompt, key: 'promptFilesLocations', label: 'prompt file locations' },
  { assetType: AssetType.Agent, key: 'agentFilesLocations', label: 'agent file locations' },
  { assetType: AssetType.Skill, key: 'agentSkillsLocations', label: 'agent skill locations' },
  { assetType: AssetType.Hook, key: 'hookFilesLocations', label: 'hook file locations' },
];

/**
 * Manages GitHub Copilot VS Code settings to point at external toolkit assets.
 * Assets live in external folders and are referenced via absolute paths —
 * no files are copied or symlinked into the workspace.
 */
export class CopilotSettingsManager {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Configure Copilot to discover assets from the given enabled toolkits.
   * Writes settings at the User (global) level so they apply across all workspaces.
   */
  async applyToolkits(toolkits: Toolkit[]): Promise<void> {
    const enabledToolkits = toolkits.filter(toolkit => toolkit.enabled);
    const knownToolkitRoots = toolkits.map(toolkit => toolkit.rootPath);

    await this.ensureFeatureFlags(enabledToolkits);
    await this.updateCodeGenInstructions(enabledToolkits, knownToolkitRoots);

    for (const locationSetting of DISCOVERY_LOCATION_SETTINGS) {
      await this.updateDiscoveryLocations(locationSetting.key, locationSetting.label, locationSetting.assetType, enabledToolkits, knownToolkitRoots);
    }

    await this.cleanupLegacyInstructionPatterns(knownToolkitRoots);
  }

  /**
   * Remove all managed Copilot settings entries.
   */
  async removeAll(): Promise<void> {
    await this.applyToolkits([]);
  }

  /**
   * Enable Copilot feature flags that control asset discovery.
   */
  private async ensureFeatureFlags(enabledToolkits: Toolkit[]): Promise<void> {
    const activeTypes = new Set<AssetType>();
    for (const toolkit of enabledToolkits) {
      for (const asset of toolkit.assets) {
        activeTypes.add(asset.type);
      }
    }

    const flags: Array<{ section: string; key: string; types: AssetType[] }> = [
      { section: 'github.copilot.chat', key: 'codeGeneration.useInstructionFiles', types: [AssetType.Instruction] },
      { section: 'chat', key: 'useAgentSkills', types: [AssetType.Skill] },
      { section: 'chat', key: 'useHooks', types: [AssetType.Hook] },
    ];

    for (const flag of flags) {
      const needed = flag.types.some(t => activeTypes.has(t));
      if (needed) {
        await this.setSetting(flag.section, flag.key, true);
      }
    }
  }

  /**
   * Update github.copilot.chat.codeGeneration.instructions with absolute
   * file paths pointing at external toolkit instruction files.
   */
  private async updateCodeGenInstructions(enabledToolkits: Toolkit[], knownToolkitRoots: string[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('github.copilot.chat');
      const existing = config.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);

      // Collect absolute paths to instruction files from enabled toolkits
      const managedEntries: Array<{ file: string }> = [];
      for (const toolkit of enabledToolkits) {
        for (const asset of toolkit.assets) {
          if (asset.type === AssetType.Instruction && !asset.isFolder) {
            managedEntries.push({ file: asset.sourcePath });
          }
        }
      }

      // Preserve user-defined entries: keep anything that isn't a path we manage.
      // We tag managed paths by checking if they appear in any known toolkit path.
      const userEntries = existing.filter(entry => {
        if ('file' in entry && typeof entry.file === 'string') {
          return !this.isPathUnderAnyRoot(entry.file, knownToolkitRoots);
        }
        return true;
      });

      const merged = [...userEntries, ...managedEntries];
      await config.update('codeGeneration.instructions', merged, vscode.ConfigurationTarget.Global);
      this.log(`Updated codeGeneration.instructions: ${managedEntries.length} external instruction files`);
    } catch (err) {
      this.log(`Could not update codeGeneration.instructions: ${err}`);
    }
  }

  /**
   * Update Copilot discovery locations so external toolkit folders are scanned
   * for custom agents, prompts, instructions, skills, and hooks.
   */
  private async updateDiscoveryLocations(
    key: string,
    label: string,
    assetType: AssetType,
    enabledToolkits: Toolkit[],
    knownToolkitRoots: string[]
  ): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('chat');
      const existing = config.get<Record<string, boolean>>(key, {});
      const cleaned: Record<string, boolean> = {};
      for (const [location, enabled] of Object.entries(existing)) {
        if (!this.isPathUnderAnyRoot(location, knownToolkitRoots)) {
          cleaned[location] = enabled;
        }
      }

      for (const toolkit of enabledToolkits) {
        const location = this.getDiscoveryFolder(toolkit, assetType);
        const configuredPath = location ? this.toConfiguredLocationPath(location) : undefined;
        if (configuredPath) {
          cleaned[configuredPath] = true;
        } else if (location) {
          this.log(`Skipped unsupported ${label} path outside the user home: ${location}`);
        }
      }

      await config.update(key, cleaned, vscode.ConfigurationTarget.Global);
      this.log(`Updated ${label}: ${Object.keys(cleaned).length} configured locations`);
    } catch (err) {
      this.log(`Could not update ${key}: ${err}`);
    }
  }

  /**
   * Remove legacy instruction file patterns that were written by older builds
   * of this extension before VS Code switched to explicit location settings.
   */
  private async cleanupLegacyInstructionPatterns(knownToolkitRoots: string[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('chat.instructionFiles');
      const existing = config.get<Record<string, boolean>>('patterns', {});
      const cleaned: Record<string, boolean> = {};

      for (const [pattern, enabled] of Object.entries(existing)) {
        if (!this.isPathUnderAnyRoot(pattern, knownToolkitRoots)) {
          cleaned[pattern] = enabled;
        }
      }

      if (Object.keys(cleaned).length !== Object.keys(existing).length) {
        await config.update('patterns', cleaned, vscode.ConfigurationTarget.Global);
        this.log('Removed legacy instruction file patterns managed by AI Toolkit');
      }
    } catch (err) {
      this.log(`Could not clean legacy instruction file patterns: ${err}`);
    }
  }

  /**
   * Add a toolkit folder as a workspace folder so Copilot can discover
   * agents, skills, and prompts from its .github/ directory.
   */
  async addAsWorkspaceFolder(toolkit: Toolkit): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const alreadyAdded = folders.some(f => f.uri.fsPath === toolkit.rootPath);
    if (alreadyAdded) {
      return;
    }

    vscode.workspace.updateWorkspaceFolders(
      folders.length,
      null,
      { uri: vscode.Uri.file(toolkit.rootPath), name: `[AI Toolkit] ${toolkit.name}` },
    );
    this.log(`Added ${toolkit.name} as workspace folder for full asset discovery`);
  }

  /**
   * Remove a toolkit's workspace folder.
   */
  async removeWorkspaceFolder(toolkit: Toolkit): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const index = folders.findIndex(f => f.uri.fsPath === toolkit.rootPath);
    if (index >= 0) {
      vscode.workspace.updateWorkspaceFolders(index, 1);
      this.log(`Removed ${toolkit.name} workspace folder`);
    }
  }

  private getDiscoveryFolder(toolkit: Toolkit, assetType: AssetType): string | undefined {
    if (!toolkit.assets.some(asset => asset.type === assetType)) {
      return undefined;
    }

    return path.join(this.getAssetsRoot(toolkit), assetType);
  }

  private getAssetsRoot(toolkit: Toolkit): string {
    const instructionAsset = toolkit.assets[0];
    if (instructionAsset && instructionAsset.relativePath.startsWith('.github/')) {
      return path.join(toolkit.rootPath, '.github');
    }

    const githubRoot = path.join(toolkit.rootPath, '.github');
    if (toolkit.assets.some(asset => asset.sourcePath.startsWith(githubRoot))) {
      return githubRoot;
    }

    return toolkit.rootPath;
  }

  private toConfiguredLocationPath(folderPath: string): string | undefined {
    const resolvedPath = path.resolve(folderPath);
    const userHome = path.resolve(os.homedir());
    const relativeToHome = path.relative(userHome, resolvedPath);

    if (relativeToHome === '') {
      return '~';
    }

    if (!relativeToHome.startsWith('..') && !path.isAbsolute(relativeToHome)) {
      return `~/${relativeToHome.replace(/\\/g, '/')}`;
    }

    return undefined;
  }

  private normalizeComparisonPath(filePath: string): string {
    const expanded = filePath.startsWith('~/')
      ? path.join(os.homedir(), filePath.slice(2))
      : filePath;

    return path.resolve(expanded).replace(/\\/g, '/');
  }

  private isPathUnderAnyRoot(filePath: string, roots: string[]): boolean {
    if (roots.length === 0) {
      return false;
    }

    const normalized = this.normalizeComparisonPath(filePath).toLowerCase();
    return roots.some(root => {
      const normalizedRoot = this.normalizeComparisonPath(root).toLowerCase();
      return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
    });
  }

  private async setSetting(section: string, key: string, value: boolean): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration(section);
      const current = config.get<boolean>(key);
      if (current !== value) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
        this.log(`Set ${section}.${key} = ${value}`);
      }
    } catch (err) {
      this.log(`Could not set ${section}.${key}: ${err}`);
    }
  }

  private log(msg: string): void {
    this.outputChannel.appendLine(`[AI Toolkit / Copilot] ${msg}`);
  }
}
