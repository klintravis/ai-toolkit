import * as fs from 'fs';
import * as path from 'path';
import { Asset, AssetType, SourceFormat, Toolkit } from './types';

/**
 * Scans configured folders to discover AI toolkits and their assets.
 */
export class ToolkitScanner {
  /**
   * Scan a single root path and return all discovered toolkits.
   * A root path may contain one toolkit (if it directly has assets)
   * or multiple toolkits (if it contains subdirectories with assets).
   */
  async scanPath(rootPath: string, enabledToolkits: Record<string, boolean>): Promise<Toolkit[]> {
    const resolved = path.resolve(rootPath);
    if (!fs.existsSync(resolved)) {
      return [];
    }

    const format = this.detectFormat(resolved);
    if (format !== null) {
      // This path itself is a toolkit
      const toolkit = await this.scanToolkit(resolved, format, enabledToolkits);
      return toolkit ? [toolkit] : [];
    }

    // Check if subdirectories are toolkits
    const toolkits: Toolkit[] = [];
    const entries = this.readDirSafe(resolved);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const subPath = path.join(resolved, entry.name);
      const subFormat = this.detectFormat(subPath);
      if (subFormat !== null) {
        const toolkit = await this.scanToolkit(subPath, subFormat, enabledToolkits);
        if (toolkit) {
          toolkits.push(toolkit);
        }
      }
    }

    return toolkits;
  }

  /**
   * Detect the format of a potential toolkit directory.
   */
  detectFormat(dirPath: string): SourceFormat | null {
    // Check for CopilotCustomizer format (.github/ with asset subfolders)
    const githubDir = path.join(dirPath, '.github');
    if (fs.existsSync(githubDir) && this.hasAssetFolders(githubDir)) {
      return SourceFormat.CopilotCustomizer;
    }

    // Check for awesome-copilot format (top-level asset folders)
    if (this.hasAssetFolders(dirPath)) {
      return SourceFormat.AwesomeCopilot;
    }

    return null;
  }

  private hasAssetFolders(dirPath: string): boolean {
    const assetFolders = ['agents', 'instructions', 'skills', 'prompts', 'plugins', 'hooks', 'workflows', 'standards'];
    return assetFolders.some(folder => {
      const fullPath = path.join(dirPath, folder);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    });
  }

  private async scanToolkit(
    rootPath: string,
    format: SourceFormat,
    enabledToolkits: Record<string, boolean>
  ): Promise<Toolkit | null> {
    const id = this.generateToolkitId(rootPath);
    const name = path.basename(rootPath);
    const assetsRoot = format === SourceFormat.CopilotCustomizer
      ? path.join(rootPath, '.github')
      : rootPath;

    const assets = await this.discoverAssets(assetsRoot, id);
    if (assets.length === 0) {
      return null;
    }

    return {
      id,
      name,
      rootPath,
      format,
      assets,
      enabled: enabledToolkits[id] ?? false,
    };
  }

  private async discoverAssets(assetsRoot: string, toolkitId: string): Promise<Asset[]> {
    const assets: Asset[] = [];
    const assetTypes: Array<{ type: AssetType; folder: string }> = [
      { type: AssetType.Agent, folder: 'agents' },
      { type: AssetType.Instruction, folder: 'instructions' },
      { type: AssetType.Skill, folder: 'skills' },
      { type: AssetType.Prompt, folder: 'prompts' },
      { type: AssetType.Plugin, folder: 'plugins' },
      { type: AssetType.Hook, folder: 'hooks' },
      { type: AssetType.Workflow, folder: 'workflows' },
      { type: AssetType.Standard, folder: 'standards' },
    ];

    for (const { type, folder } of assetTypes) {
      const folderPath = path.join(assetsRoot, folder);
      if (!fs.existsSync(folderPath)) {
        continue;
      }

      const discovered = this.scanAssetFolder(folderPath, type, toolkitId, folder);
      assets.push(...discovered);
    }

    return assets;
  }

  private scanAssetFolder(
    folderPath: string,
    type: AssetType,
    toolkitId: string,
    relativeBase: string
  ): Asset[] {
    const assets: Asset[] = [];
    const entries = this.readDirSafe(folderPath);

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        // Folder-based assets: skills, plugins, hooks, standards
        if (this.isFolderAsset(type)) {
          const relativePath = `${relativeBase}/${entry.name}`;
          const assetName = this.formatAssetName(entry.name, type);
          assets.push({
            id: `${toolkitId}::${relativePath}`,
            name: assetName,
            type,
            sourcePath: fullPath,
            relativePath,
            isFolder: true,
          });
        } else {
          // Recurse into subdirectories for file-based assets (e.g., standards with category folders)
          const subAssets = this.scanAssetFolder(fullPath, type, toolkitId, `${relativeBase}/${entry.name}`);
          assets.push(...subAssets);
        }
      } else if (entry.isFile() && this.matchesAssetType(entry.name, type)) {
        const relativePath = `${relativeBase}/${entry.name}`;
        const assetName = this.formatAssetName(entry.name, type);
        assets.push({
          id: `${toolkitId}::${relativePath}`,
          name: assetName,
          type,
          sourcePath: fullPath,
          relativePath,
          isFolder: false,
        });
      }
    }

    return assets;
  }

  private isFolderAsset(type: AssetType): boolean {
    return [AssetType.Skill, AssetType.Plugin, AssetType.Hook, AssetType.Standard].includes(type);
  }

  private matchesAssetType(filename: string, type: AssetType): boolean {
    const lower = filename.toLowerCase();
    switch (type) {
      case AssetType.Agent:
        return lower.endsWith('.agent.md');
      case AssetType.Instruction:
        return lower.endsWith('.instructions.md');
      case AssetType.Prompt:
        return lower.endsWith('.prompt.md');
      case AssetType.Workflow:
        return lower.endsWith('.md');
      default:
        return lower.endsWith('.md') || lower.endsWith('.json') || lower.endsWith('.yaml');
    }
  }

  private formatAssetName(filename: string, type: AssetType): string {
    // Strip known suffixes
    let name = filename;
    const suffixes = ['.agent.md', '.instructions.md', '.prompt.md', '.md', '.json', '.yaml'];
    for (const suffix of suffixes) {
      if (name.toLowerCase().endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        break;
      }
    }
    // Convert kebab-case to title
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  private generateToolkitId(rootPath: string): string {
    // Use the last two path segments as a stable ID
    const parts = rootPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const tail = parts.slice(-2).join('/');
    return tail;
  }

  private readDirSafe(dirPath: string): fs.Dirent[] {
    try {
      return fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }
}
