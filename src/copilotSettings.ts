import * as path from 'path';
import * as vscode from 'vscode';
import { AssetType, Toolkit } from './types';

/**
 * Copilot feature flags that control asset discovery.
 * These VS Code settings tell GitHub Copilot to look for assets in .github/.
 */
const COPILOT_FEATURE_FLAGS: Record<string, { setting: string; section: string }> = {
  agents: { setting: 'enabled', section: 'chat.agent.agentFiles' },
  instructions: { setting: 'enabled', section: 'chat.instructionFiles' },
  prompts: { setting: 'enabled', section: 'chat.promptFiles' },
};

/**
 * Manages GitHub Copilot VS Code settings to ensure assets are discovered.
 */
export class CopilotSettingsManager {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Enable the Copilot settings needed for the given toolkits' asset types.
   */
  async enableCopilotFeatures(toolkits: Toolkit[]): Promise<void> {
    const enabledToolkits = toolkits.filter(t => t.enabled);
    if (enabledToolkits.length === 0) {
      return;
    }

    // Determine which asset types are present across all enabled toolkits
    const activeTypes = new Set<AssetType>();
    for (const toolkit of enabledToolkits) {
      for (const asset of toolkit.assets) {
        activeTypes.add(asset.type);
      }
    }

    // Enable corresponding Copilot feature flags
    for (const [assetFolder, { setting, section }] of Object.entries(COPILOT_FEATURE_FLAGS)) {
      const type = assetFolder as string;
      const matchingType = Object.values(AssetType).find(t => t === type);
      if (matchingType && activeTypes.has(matchingType)) {
        await this.ensureCopilotSetting(section, setting, true);
      }
    }

    // Update code generation instructions to reference synced instruction files
    if (activeTypes.has(AssetType.Instruction)) {
      await this.updateCodeGenInstructions(enabledToolkits);
    }
  }

  /**
   * Ensure a Copilot setting is set to the desired value.
   * Only writes if the current value differs, to avoid unnecessary config churn.
   */
  private async ensureCopilotSetting(section: string, key: string, value: boolean): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration(section);
      const current = config.get<boolean>(key);
      if (current !== value) {
        await config.update(key, value, vscode.ConfigurationTarget.Workspace);
        this.log(`Set ${section}.${key} = ${value}`);
      }
    } catch (err) {
      // Setting may not exist in this version of VS Code / Copilot
      this.log(`Could not set ${section}.${key}: ${err}`);
    }
  }

  /**
   * Update github.copilot.chat.codeGeneration.instructions to reference
   * instruction files from enabled toolkits.
   */
  private async updateCodeGenInstructions(toolkits: Toolkit[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('github.copilot.chat');
      const existing = config.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);

      // Collect instruction file paths from enabled toolkits
      const managedEntries: Array<{ file: string }> = [];
      for (const toolkit of toolkits) {
        for (const asset of toolkit.assets) {
          if (asset.type === AssetType.Instruction && !asset.isFolder) {
            // Reference via workspace-relative path (.github/instructions/...)
            const wsRelative = `.github/instructions/${path.basename(asset.sourcePath)}`;
            managedEntries.push({ file: wsRelative });
          }
        }
      }

      // Preserve user-defined entries (those without our marker pattern)
      const userEntries = existing.filter(entry => {
        if ('file' in entry && typeof entry.file === 'string') {
          return !entry.file.startsWith('.github/instructions/');
        }
        return true;
      });

      const merged = [...userEntries, ...managedEntries];
      await config.update('codeGeneration.instructions', merged, vscode.ConfigurationTarget.Workspace);
      this.log(`Updated codeGeneration.instructions with ${managedEntries.length} instruction files`);
    } catch (err) {
      this.log(`Could not update codeGeneration.instructions: ${err}`);
    }
  }

  /**
   * Remove managed entries from Copilot code generation instructions.
   */
  async cleanCopilotInstructions(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('github.copilot.chat');
      const existing = config.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);
      const cleaned = existing.filter(entry => {
        if ('file' in entry && typeof entry.file === 'string') {
          return !entry.file.startsWith('.github/instructions/');
        }
        return true;
      });

      if (cleaned.length !== existing.length) {
        await config.update('codeGeneration.instructions', cleaned, vscode.ConfigurationTarget.Workspace);
        this.log('Cleaned managed entries from codeGeneration.instructions');
      }
    } catch {
      // ignore
    }
  }

  private log(msg: string): void {
    this.outputChannel.appendLine(`[AI Toolkit / Copilot Settings] ${msg}`);
  }
}
