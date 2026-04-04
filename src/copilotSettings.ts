import * as path from 'path';
import * as vscode from 'vscode';
import { Asset, AssetType, Toolkit } from './types';

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
    const enabled = toolkits.filter(t => t.enabled);

    // Enable Copilot feature flags
    await this.ensureFeatureFlags(enabled);

    // Configure code generation instructions with absolute paths
    await this.updateCodeGenInstructions(enabled);

    // Configure custom instructions file locations
    await this.updateInstructionFileLocations(enabled);
  }

  /**
   * Remove all managed Copilot settings entries.
   */
  async removeAll(): Promise<void> {
    await this.updateCodeGenInstructions([]);
    await this.updateInstructionFileLocations([]);
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
      { section: 'chat.instructionFiles', key: 'enabled', types: [AssetType.Instruction] },
      { section: 'chat.promptFiles', key: 'enabled', types: [AssetType.Prompt] },
      { section: 'chat.agent.agentFiles', key: 'enabled', types: [AssetType.Agent] },
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
  private async updateCodeGenInstructions(enabledToolkits: Toolkit[]): Promise<void> {
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
      const allToolkitRoots = enabledToolkits.map(t => t.rootPath);
      const userEntries = existing.filter(entry => {
        if ('file' in entry && typeof entry.file === 'string') {
          return !this.isPathUnderAnyRoot(entry.file, allToolkitRoots);
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
   * Update instruction file location patterns to include external toolkit folders.
   * This tells Copilot to also look for instruction files in the toolkit directories.
   */
  private async updateInstructionFileLocations(enabledToolkits: Toolkit[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('chat.instructionFiles');
      const existing = config.get<Record<string, boolean>>('patterns', {});

      // Remove previously managed toolkit patterns (those pointing at external toolkit paths)
      const cleaned: Record<string, boolean> = {};
      for (const [pattern, enabled] of Object.entries(existing)) {
        // Keep patterns that don't look like absolute paths to toolkit folders
        if (!pattern.startsWith('/') || !pattern.includes('/instructions/')) {
          cleaned[pattern] = enabled;
        }
      }

      // Add patterns for each enabled toolkit's instruction directory
      for (const toolkit of enabledToolkits) {
        const instructionAssets = toolkit.assets.filter(a => a.type === AssetType.Instruction);
        if (instructionAssets.length > 0) {
          const instructionDir = path.dirname(instructionAssets[0].sourcePath);
          cleaned[`${instructionDir}/**/*.instructions.md`] = true;
        }
      }

      await config.update('patterns', cleaned, vscode.ConfigurationTarget.Global);
    } catch (err) {
      // This setting may not exist in all Copilot versions
      this.log(`Could not update instructionFiles.patterns: ${err}`);
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

  private isPathUnderAnyRoot(filePath: string, roots: string[]): boolean {
    const normalized = path.resolve(filePath);
    return roots.some(root => normalized.startsWith(path.resolve(root)));
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
