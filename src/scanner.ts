import * as fs from 'fs';
import * as path from 'path';
import { pathExists, toToolkitId } from './pathUtils';
import { Asset, AssetType, SourceFormat, Toolkit } from './types';

/** Maximum recursion depth when scanning asset subdirectories. */
const MAX_SCAN_DEPTH = 5;

/** Filenames excluded from asset discovery regardless of extension. */
const EXCLUDED_FILENAMES = new Set([
  'readme.md', 'changelog.md', 'license.md', 'contributing.md',
]);

/**
 * Scans configured folders to discover AI toolkits and their assets.
 */
export class ToolkitScanner {
  async scanPath(rootPath: string, enabledToolkits: Record<string, boolean>): Promise<Toolkit[]> {
    const resolved = path.resolve(rootPath);
    if (!(await pathExists(resolved))) {
      return [];
    }

    const detected = await this.detectFormat(resolved);
    if (detected) {
      const toolkit = await this.scanToolkit(resolved, detected.format, detected.mergeGithub, enabledToolkits);
      return toolkit ? [toolkit] : [];
    }

    const toolkits: Toolkit[] = [];
    const entries = await this.readDirSafe(resolved);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const subPath = path.join(resolved, entry.name);
      const sub = await this.detectFormat(subPath);
      if (sub) {
        const toolkit = await this.scanToolkit(subPath, sub.format, sub.mergeGithub, enabledToolkits);
        if (toolkit) {
          toolkits.push(toolkit);
        }
      }
    }

    return toolkits;
  }

  /**
   * Detect the source format and whether both roots have assets (hybrid repo).
   * Returns null when no asset folders are found.
   */
  private async detectFormat(dirPath: string): Promise<{ format: SourceFormat; mergeGithub: boolean } | null> {
    const topHasAssets = await this.hasAssetFolders(dirPath);
    const githubDir = path.join(dirPath, '.github');
    const githubHasAssets = (await pathExists(githubDir)) && (await this.hasAssetFolders(githubDir));

    if (topHasAssets) {
      return { format: SourceFormat.AwesomeCopilot, mergeGithub: githubHasAssets };
    }
    if (githubHasAssets) {
      return { format: SourceFormat.CopilotCustomizer, mergeGithub: false };
    }
    return null;
  }

  private async hasAssetFolders(dirPath: string): Promise<boolean> {
    const assetFolders = Object.values(AssetType);
    for (const folder of assetFolders) {
      const fullPath = path.join(dirPath, folder);
      if (await isDirectory(fullPath)) {
        return true;
      }
    }
    return false;
  }

  private async scanToolkit(
    rootPath: string,
    format: SourceFormat,
    mergeGithub: boolean,
    enabledToolkits: Record<string, boolean>
  ): Promise<Toolkit | null> {
    const id = this.createToolkitId(rootPath);
    const name = path.basename(rootPath);

    const assetRoots: string[] = [];
    if (format === SourceFormat.CopilotCustomizer) {
      assetRoots.push(path.join(rootPath, '.github'));
    } else {
      assetRoots.push(rootPath);
      if (mergeGithub) {
        assetRoots.push(path.join(rootPath, '.github'));
      }
    }

    const assets: Asset[] = [];
    const seen = new Set<string>();
    for (const root of assetRoots) {
      const discovered = await this.discoverAssets(root, id, rootPath);
      for (const asset of discovered) {
        if (!seen.has(asset.id)) {
          seen.add(asset.id);
          assets.push(asset);
        }
      }
    }

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

  private async discoverAssets(assetsRoot: string, toolkitId: string, toolkitRoot: string): Promise<Asset[]> {
    const assets: Asset[] = [];
    let toolkitRealRoot: string;
    try {
      toolkitRealRoot = (await fs.promises.realpath(toolkitRoot)).replace(/\\/g, '/').toLowerCase();
    } catch {
      toolkitRealRoot = toolkitRoot.replace(/\\/g, '/').toLowerCase();
    }
    const visited = new Set<string>();

    for (const type of Object.values(AssetType)) {
      const folderPath = path.join(assetsRoot, type);
      if (!(await pathExists(folderPath))) {
        continue;
      }

      const discovered = await this.scanAssetFolder(folderPath, type, toolkitId, type, MAX_SCAN_DEPTH, toolkitRealRoot, visited);
      assets.push(...discovered);
    }

    return assets;
  }

  private async scanAssetFolder(
    folderPath: string,
    type: AssetType,
    toolkitId: string,
    relativeBase: string,
    depth: number,
    toolkitRealRoot: string,
    visited: Set<string>,
  ): Promise<Asset[]> {
    if (depth <= 0) {
      return [];
    }

    const assets: Asset[] = [];
    const entries = await this.readDirSafe(folderPath);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(folderPath, entry.name);
      const kind = await this.classifyEntry(fullPath, entry, toolkitRealRoot, visited);

      if (kind.isDirectory) {
        if (this.isFolderAsset(type)) {
          const relativePath = `${relativeBase}/${entry.name}`;
          const assetName = this.deriveDisplayName(entry.name);
          const folderAssetId = `${toolkitId}::${relativePath}`;
          const children = await this.scanFolderContents(fullPath, type, folderAssetId, relativePath, depth - 1, toolkitRealRoot, visited);
          assets.push({
            id: folderAssetId,
            name: assetName,
            type,
            sourcePath: fullPath,
            relativePath,
            isFolder: true,
            children,
          });
        } else {
          const subAssets = await this.scanAssetFolder(
            fullPath, type, toolkitId, `${relativeBase}/${entry.name}`, depth - 1, toolkitRealRoot, visited
          );
          assets.push(...subAssets);
        }
      } else if (kind.isFile && this.isAssetFile(entry.name, type)) {
        const relativePath = `${relativeBase}/${entry.name}`;
        const assetName = this.deriveDisplayName(entry.name);
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

  private async scanFolderContents(
    folderPath: string,
    type: AssetType,
    parentId: string,
    parentRelativePath: string,
    depth: number,
    toolkitRealRoot: string,
    visited: Set<string>,
  ): Promise<Asset[]> {
    if (depth <= 0) { return []; }
    const children: Asset[] = [];
    const entries = await this.readDirSafe(folderPath);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) { continue; }
      const fullPath = path.join(folderPath, entry.name);
      const relativePath = `${parentRelativePath}/${entry.name}`;
      const kind = await this.classifyEntry(fullPath, entry, toolkitRealRoot, visited);
      if (kind.isDirectory) {
        const nested = await this.scanFolderContents(fullPath, type, parentId, relativePath, depth - 1, toolkitRealRoot, visited);
        if (nested.length > 0) {
          children.push({
            id: `${parentId}::${entry.name}`,
            name: entry.name,
            type,
            sourcePath: fullPath,
            relativePath,
            isFolder: true,
            children: nested,
          });
        }
      } else if (kind.isFile) {
        children.push({
          id: `${parentId}::${entry.name}`,
          name: entry.name,
          type,
          sourcePath: fullPath,
          relativePath,
          isFolder: false,
        });
      }
    }
    return children;
  }

  private isFolderAsset(type: AssetType): boolean {
    return [AssetType.Skill, AssetType.Plugin, AssetType.Hook, AssetType.Standard].includes(type);
  }

  private isAssetFile(filename: string, type: AssetType): boolean {
    const lower = filename.toLowerCase();
    if (EXCLUDED_FILENAMES.has(lower)) {
      return false;
    }
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

  private deriveDisplayName(filename: string): string {
    let name = filename;
    const suffixes = ['.agent.md', '.instructions.md', '.prompt.md', '.md', '.json', '.yaml'];
    for (const suffix of suffixes) {
      if (name.toLowerCase().endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        break;
      }
    }
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  private createToolkitId(rootPath: string): string {
    return toToolkitId(rootPath);
  }


  /**
   * Classify a directory entry as file or directory, following symlinks.
   * `Dirent.isFile()` / `isDirectory()` return false for symlinks — we
   * stat the target so symlinked assets (e.g. picks) are classified correctly.
   */
  private async classifyEntry(
    fullPath: string,
    entry: fs.Dirent,
    toolkitRealRoot?: string,
    visited?: Set<string>,
  ): Promise<{ isFile: boolean; isDirectory: boolean }> {
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.promises.stat(fullPath);
        const realPath = await fs.promises.realpath(fullPath);
        // Containment: reject symlinks that escape the toolkit root
        if (toolkitRealRoot) {
          const normalizedReal = realPath.replace(/\\/g, '/').toLowerCase();
          const normalizedRoot = toolkitRealRoot.replace(/\\/g, '/').toLowerCase();
          if (normalizedReal !== normalizedRoot && !normalizedReal.startsWith(normalizedRoot + '/')) {
            return { isFile: false, isDirectory: false };
          }
        }
        // Cycle detection: skip already-visited directories
        if (stat.isDirectory() && visited) {
          const key = realPath.replace(/\\/g, '/').toLowerCase();
          if (visited.has(key)) {
            return { isFile: false, isDirectory: false };
          }
          visited.add(key);
        }
        return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
      } catch {
        // broken symlink — treat as nothing
        return { isFile: false, isDirectory: false };
      }
    }
    return { isFile: entry.isFile(), isDirectory: entry.isDirectory() };
  }

  private async readDirSafe(dirPath: string): Promise<fs.Dirent[]> {
    try {
      return await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Cannot read directory ${dirPath}:`, err);
      }
      return [];
    }
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
