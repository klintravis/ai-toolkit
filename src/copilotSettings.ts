import * as path from 'path';
import * as vscode from 'vscode';
import { isPathUnderAnyRoot, normalizeForComparison, toHomeRelativePath } from './pathUtils';
import { AssetType, SourceFormat, Toolkit } from './types';

const MANAGED_ROOTS_SECTION = 'aiToolkit';
const MANAGED_ROOTS_KEY = 'managedToolkitRoots';

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

  async applyToolkits(toolkits: Toolkit[]): Promise<void> {
    const enabledToolkits = toolkits.filter(toolkit => toolkit.enabled);
    const knownToolkitRoots = toolkits.map(toolkit => toolkit.rootPath);
    const persistedManagedRoots = this.getManagedToolkitRoots();
    const cleanupRoots = this.mergeUniquePaths([...knownToolkitRoots, ...persistedManagedRoots]);
    const unsupportedToolkitNames = new Set<string>();

    await this.enableRequiredFeatureFlags(enabledToolkits);
    await this.updateCodeGenInstructions(enabledToolkits, cleanupRoots);

    for (const locationSetting of DISCOVERY_LOCATION_SETTINGS) {
      await this.updateDiscoveryLocations(
        locationSetting.key,
        locationSetting.label,
        locationSetting.assetType,
        enabledToolkits,
        cleanupRoots,
        unsupportedToolkitNames
      );
    }

    if (unsupportedToolkitNames.size > 0) {
      void vscode.window.showWarningMessage(
        `AI Toolkit could not configure one or more discovery locations because paths are outside your home directory for: ${[...unsupportedToolkitNames].join(', ')}`,
      );
    }

    await this.removeLegacyInstructionPatterns(cleanupRoots);
    await this.setManagedToolkitRoots(knownToolkitRoots);
  }

  async removeAll(): Promise<void> {
    await this.applyToolkits([]);
  }

  /**
   * Enable Copilot feature flags that control asset discovery.
   *
   * Flags are only set to `true`, never removed, because they enable general
   * Copilot capabilities (instruction files, skills, hooks) that the user may
   * also rely on outside of this extension. Removing them could disable
   * features the user intentionally configured elsewhere.
   */
  private async enableRequiredFeatureFlags(enabledToolkits: Toolkit[]): Promise<void> {
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

  private async updateCodeGenInstructions(enabledToolkits: Toolkit[], knownToolkitRoots: string[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('github.copilot.chat');
      const existing = config.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);

      const managedEntries: Array<{ file: string }> = [];
      for (const toolkit of enabledToolkits) {
        for (const asset of toolkit.assets) {
          if (asset.type === AssetType.Instruction && !asset.isFolder) {
            managedEntries.push({ file: asset.sourcePath });
          }
        }
      }

      // Preserve user-defined entries: keep anything that isn't under a known toolkit root
      const userEntries = existing.filter(entry => {
        if ('file' in entry && typeof entry.file === 'string') {
          return !isPathUnderAnyRoot(entry.file, knownToolkitRoots);
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

  private async updateDiscoveryLocations(
    key: string,
    label: string,
    assetType: AssetType,
    enabledToolkits: Toolkit[],
    knownToolkitRoots: string[],
    unsupportedToolkitNames: Set<string>
  ): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('chat');
      const existing = config.get<Record<string, boolean>>(key, {});
      const cleaned: Record<string, boolean> = {};
      for (const [location, enabled] of Object.entries(existing)) {
        if (!isPathUnderAnyRoot(location, knownToolkitRoots)) {
          cleaned[location] = enabled;
        }
      }

      for (const toolkit of enabledToolkits) {
        const locations = this.getDiscoveryFolders(toolkit, assetType);
        for (const location of locations) {
          const tilePath = toHomeRelativePath(location);
          if (tilePath) {
            cleaned[tilePath] = true;
          } else {
            unsupportedToolkitNames.add(toolkit.name);
            this.log(`Skipped unsupported ${label} path outside the user home: ${location}`);
          }
        }
      }

      await config.update(key, cleaned, vscode.ConfigurationTarget.Global);
      this.log(`Updated ${label}: ${Object.keys(cleaned).length} configured locations`);
    } catch (err) {
      this.log(`Could not update ${key}: ${err}`);
    }
  }

  /** Remove legacy instruction file patterns from older extension versions. */
  private async removeLegacyInstructionPatterns(knownToolkitRoots: string[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('chat.instructionFiles');
      const existing = config.get<Record<string, boolean>>('patterns', {});
      const cleaned: Record<string, boolean> = {};

      for (const [pattern, enabled] of Object.entries(existing)) {
        if (!isPathUnderAnyRoot(pattern, knownToolkitRoots)) {
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

  addAsWorkspaceFolder(toolkit: Toolkit): void {
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

  removeWorkspaceFolder(toolkit: Toolkit): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const index = folders.findIndex(f => f.uri.fsPath === toolkit.rootPath);
    if (index >= 0) {
      vscode.workspace.updateWorkspaceFolders(index, 1);
      this.log(`Removed ${toolkit.name} workspace folder`);
    }
  }

  private getDiscoveryFolders(toolkit: Toolkit, assetType: AssetType): string[] {
    if (!toolkit.assets.some(asset => asset.type === assetType)) {
      return [];
    }

    // Collect unique parent directories from actual asset sourcePaths.
    const folderSet = new Set<string>();
    for (const asset of toolkit.assets) {
      if (asset.type === assetType) {
        folderSet.add(path.dirname(asset.sourcePath));
      }
    }
    return Array.from(folderSet);
  }

  private getManagedToolkitRoots(): string[] {
    const config = vscode.workspace.getConfiguration(MANAGED_ROOTS_SECTION);
    const roots = config.get<string[]>(MANAGED_ROOTS_KEY, []);
    return Array.isArray(roots) ? roots.filter(root => typeof root === 'string') : [];
  }

  private async setManagedToolkitRoots(roots: string[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration(MANAGED_ROOTS_SECTION);
      const nextRoots = this.mergeUniquePaths(roots);
      await config.update(MANAGED_ROOTS_KEY, nextRoots, vscode.ConfigurationTarget.Global);
      this.log(`Updated ${MANAGED_ROOTS_SECTION}.${MANAGED_ROOTS_KEY}: ${nextRoots.length} roots`);
    } catch (err) {
      this.log(`Could not update ${MANAGED_ROOTS_SECTION}.${MANAGED_ROOTS_KEY}: ${err}`);
    }
  }

  private mergeUniquePaths(paths: string[]): string[] {
    const deduped = new Map<string, string>();
    for (const p of paths) {
      const key = normalizeForComparison(p);
      if (!deduped.has(key)) {
        deduped.set(key, path.resolve(p));
      }
    }
    return [...deduped.values()];
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
