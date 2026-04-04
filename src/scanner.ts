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
    if (!(await this.pathExists(resolved))) {
      return [];
    }

    const format = await this.detectFormat(resolved);
    if (format !== null) {
      // This path itself is a toolkit
      const toolkit = await this.scanToolkit(resolved, format, enabledToolkits);
      return toolkit ? [toolkit] : [];
    }

    // Check if subdirectories are toolkits
    const toolkits: Toolkit[] = [];
    const entries = await this.readDirSafe(resolved);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const subPath = path.join(resolved, entry.name);
      const subFormat = await this.detectFormat(subPath);
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
  private async detectFormat(dirPath: string): Promise<SourceFormat | null> {
    // Check for CopilotCustomizer format (.github/ with asset subfolders)
    const githubDir = path.join(dirPath, '.github');
    if ((await this.pathExists(githubDir)) && (await this.hasAssetFolders(githubDir))) {
      return SourceFormat.CopilotCustomizer;
    }

    // Check for awesome-copilot format (top-level asset folders)
    if (await this.hasAssetFolders(dirPath)) {
      return SourceFormat.AwesomeCopilot;
    }

    return null;
  }

  private async hasAssetFolders(dirPath: string): Promise<boolean> {
    const assetFolders = Object.values(AssetType);
    for (const folder of assetFolders) {
      const fullPath = path.join(dirPath, folder);
      if (await this.isDirectory(fullPath)) {
        return true;
      }
    }
    return false;
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

    for (const type of Object.values(AssetType)) {
      const folderPath = path.join(assetsRoot, type);
      if (!(await this.pathExists(folderPath))) {
        continue;
      }

      const discovered = await this.scanAssetFolder(folderPath, type, toolkitId, type);
      assets.push(...discovered);
    }

    return assets;
  }

  private async scanAssetFolder(
    folderPath: string,
    type: AssetType,
    toolkitId: string,
    relativeBase: string
  ): Promise<Asset[]> {
    const assets: Asset[] = [];
    const entries = await this.readDirSafe(folderPath);

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        // Folder-based assets: skills, plugins, hooks, standards
        if (this.isFolderAsset(type)) {
          const relativePath = `${relativeBase}/${entry.name}`;
          const assetName = this.formatAssetName(entry.name);
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
          const subAssets = await this.scanAssetFolder(fullPath, type, toolkitId, `${relativeBase}/${entry.name}`);
          assets.push(...subAssets);
        }
      } else if (entry.isFile() && this.matchesAssetType(entry.name, type)) {
        const relativePath = `${relativeBase}/${entry.name}`;
        const assetName = this.formatAssetName(entry.name);
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

  private formatAssetName(filename: string): string {
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

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.promises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async isDirectory(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async readDirSafe(dirPath: string): Promise<fs.Dirent[]> {
    try {
      return await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }
}
