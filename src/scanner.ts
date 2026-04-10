import * as fs from 'fs';
import * as path from 'path';
import { pathExists, toToolkitId } from './pathUtils';
import { Asset, AssetMapping, AssetType, SourceFormat, Toolkit, ToolkitManifest } from './types';

const MAX_SCAN_DEPTH = 5;
const EXCLUDED_FILENAMES = new Set([
  'readme.md', 'changelog.md', 'license.md', 'contributing.md',
]);

export const DEFAULT_ASSET_MAPPINGS: AssetMapping[] = [
  { folder: 'copilot/agents',       assetType: AssetType.Agent,       platform: 'copilot', isFolder: false, extensions: ['.agent.md'] },
  { folder: 'copilot/instructions', assetType: AssetType.Instruction, platform: 'copilot', isFolder: false, extensions: ['.instructions.md'] },
  { folder: 'copilot/prompts',      assetType: AssetType.Prompt,      platform: 'copilot', isFolder: false, extensions: ['.prompt.md'] },
  { folder: 'copilot/plugins',      assetType: AssetType.Plugin,      platform: 'copilot', isFolder: true },
  { folder: 'copilot/hooks',        assetType: AssetType.Hook,        platform: 'copilot', isFolder: true },
  { folder: 'copilot/workflows',    assetType: AssetType.Workflow,    platform: 'copilot', isFolder: false, extensions: ['.md'] },
  { folder: 'claude/skills',        assetType: AssetType.Skill,       platform: 'both',    isFolder: true },
  { folder: 'claude/hooks',         assetType: AssetType.Hook,        platform: 'claude',  isFolder: false, extensions: ['.json'] },
  { folder: 'claude/mcps',          assetType: AssetType.McpServer,   platform: 'claude',  isFolder: false, extensions: ['.json'] },
  { folder: 'claude/instructions',  assetType: AssetType.Instruction, platform: 'claude',  isFolder: false, extensions: ['.md'] },
  { folder: 'shared/standards',     assetType: AssetType.Standard,    platform: 'shared',  isFolder: true },
  { folder: 'shared/docs',          assetType: AssetType.Doc,         platform: 'shared',  isFolder: false, extensions: ['.md'] },
];

export class ToolkitScanner {
  async scanPath(
    rootPath: string,
    enabledToolkits: Record<string, boolean>,
    mappings: AssetMapping[] = DEFAULT_ASSET_MAPPINGS,
  ): Promise<Toolkit[]> {
    const resolved = path.resolve(rootPath);
    if (!(await pathExists(resolved))) return [];

    if (await this.isDualPlatformToolkit(resolved, mappings)) {
      const toolkit = await this.scanToolkit(resolved, mappings, enabledToolkits);
      return toolkit ? [toolkit] : [];
    }

    const toolkits: Toolkit[] = [];
    const entries = await this.readDirSafe(resolved);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const subPath = path.join(resolved, entry.name);
      if (await this.isDualPlatformToolkit(subPath, mappings)) {
        const toolkit = await this.scanToolkit(subPath, mappings, enabledToolkits);
        if (toolkit) toolkits.push(toolkit);
      }
    }
    return toolkits;
  }

  private async isDualPlatformToolkit(dirPath: string, mappings: AssetMapping[]): Promise<boolean> {
    const topFolders = new Set(mappings.map(m => m.folder.split('/')[0]));
    for (const folder of topFolders) {
      if (await isDirectory(path.join(dirPath, folder))) return true;
    }
    return false;
  }

  private async scanToolkit(
    rootPath: string,
    mappings: AssetMapping[],
    enabledToolkits: Record<string, boolean>,
  ): Promise<Toolkit | null> {
    const id = toToolkitId(rootPath);
    const manifest = await this.loadManifest(rootPath);
    const effectiveMappings = manifest?.mappings
      ? [...mappings, ...manifest.mappings]
      : mappings;
    const displayName = manifest?.name ?? path.basename(rootPath);

    let toolkitRealRoot: string;
    try {
      toolkitRealRoot = (await fs.promises.realpath(rootPath)).replace(/\\/g, '/').toLowerCase();
    } catch {
      toolkitRealRoot = rootPath.replace(/\\/g, '/').toLowerCase();
    }
    const visited = new Set<string>();
    const assets: Asset[] = [];
    const seen = new Set<string>();

    for (const mapping of effectiveMappings) {
      const folderPath = path.join(rootPath, ...mapping.folder.split('/'));
      if (!(await pathExists(folderPath))) continue;
      const discovered = await this.scanMappingFolder(
        folderPath, mapping, id, mapping.folder, MAX_SCAN_DEPTH, toolkitRealRoot, visited,
      );
      for (const asset of discovered) {
        if (!seen.has(asset.id)) { seen.add(asset.id); assets.push(asset); }
      }
    }

    if (assets.length === 0) return null;

    return { id, name: displayName, rootPath, format: SourceFormat.DualPlatform, assets, enabled: enabledToolkits[id] ?? false };
  }

  private async scanMappingFolder(
    folderPath: string,
    mapping: AssetMapping,
    toolkitId: string,
    relativeBase: string,
    depth: number,
    toolkitRealRoot: string,
    visited: Set<string>,
  ): Promise<Asset[]> {
    if (depth <= 0) return [];
    const assets: Asset[] = [];
    const entries = await this.readDirSafe(folderPath);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(folderPath, entry.name);
      const kind = await this.classifyEntry(fullPath, entry, toolkitRealRoot, visited);

      if (mapping.isFolder) {
        if (kind.isDirectory) {
          const relativePath = `${relativeBase}/${entry.name}`;
          const assetId = `${toolkitId}::${relativePath}`;
          const children = await this.scanFolderContents(fullPath, mapping.assetType, assetId, relativePath, depth - 1, toolkitRealRoot, visited);
          assets.push({
            id: assetId, name: this.deriveDisplayName(entry.name), type: mapping.assetType,
            sourcePath: fullPath, relativePath, isFolder: true, platform: mapping.platform, children,
          });
        }
      } else {
        if (kind.isFile && this.isAssetFile(entry.name, mapping)) {
          const relativePath = `${relativeBase}/${entry.name}`;
          assets.push({
            id: `${toolkitId}::${relativePath}`, name: this.deriveDisplayName(entry.name),
            type: mapping.assetType, sourcePath: fullPath, relativePath, isFolder: false, platform: mapping.platform,
          });
        } else if (kind.isDirectory) {
          const sub = await this.scanMappingFolder(fullPath, mapping, toolkitId, `${relativeBase}/${entry.name}`, depth - 1, toolkitRealRoot, visited);
          assets.push(...sub);
        }
      }
    }
    return assets;
  }

  private async scanFolderContents(
    folderPath: string, type: AssetType, parentId: string, parentRelPath: string,
    depth: number, toolkitRealRoot: string, visited: Set<string>,
  ): Promise<Asset[]> {
    if (depth <= 0) return [];
    const toolkitId = parentId.split('::')[0];
    const children: Asset[] = [];
    const entries = await this.readDirSafe(folderPath);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(folderPath, entry.name);
      const relativePath = `${parentRelPath}/${entry.name}`;
      const kind = await this.classifyEntry(fullPath, entry, toolkitRealRoot, visited);
      if (kind.isDirectory) {
        const nested = await this.scanFolderContents(fullPath, type, parentId, relativePath, depth - 1, toolkitRealRoot, visited);
        if (nested.length > 0) {
          children.push({ id: `${toolkitId}::${relativePath}`, name: entry.name, type, sourcePath: fullPath, relativePath, isFolder: true, platform: 'both', children: nested });
        }
      } else if (kind.isFile) {
        children.push({ id: `${toolkitId}::${relativePath}`, name: entry.name, type, sourcePath: fullPath, relativePath, isFolder: false, platform: 'both' });
      }
    }
    return children;
  }

  private async loadManifest(toolkitRoot: string): Promise<ToolkitManifest | null> {
    const manifestPath = path.join(toolkitRoot, 'ai-toolkit.json');
    try {
      const content = await fs.promises.readFile(manifestPath, 'utf-8');
      const raw = JSON.parse(content);
      if (typeof raw !== 'object' || raw === null) return null;
      const manifest: ToolkitManifest = {};
      if (typeof raw.name === 'string') manifest.name = raw.name;
      if (Array.isArray(raw.mappings)) {
        manifest.mappings = (raw.mappings as unknown[]).filter((m): m is AssetMapping => {
          if (typeof m !== 'object' || m === null) return false;
          const e = m as Record<string, unknown>;
          if (typeof e.folder !== 'string' || typeof e.assetType !== 'string') return false;
          if (!['copilot', 'claude', 'both', 'shared'].includes(e.platform as string)) return false;
          if ('extensions' in e && !Array.isArray(e.extensions)) return false;
          return true;
        });
      }
      return manifest;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[AI Toolkit] Invalid ai-toolkit.json at ${toolkitRoot}: ${err}`);
      }
      return null;
    }
  }

  private isAssetFile(filename: string, mapping: AssetMapping): boolean {
    const lower = filename.toLowerCase();
    if (EXCLUDED_FILENAMES.has(lower)) return false;
    if (mapping.extensions && mapping.extensions.length > 0) {
      return mapping.extensions.some(ext => lower.endsWith(ext.toLowerCase()));
    }
    return lower.endsWith('.md') || lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml');
  }

  private deriveDisplayName(filename: string): string {
    let name = filename;
    for (const suffix of ['.agent.md', '.instructions.md', '.prompt.md', '.md', '.json', '.yaml', '.yml']) {
      if (name.toLowerCase().endsWith(suffix)) { name = name.slice(0, -suffix.length); break; }
    }
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private async classifyEntry(
    fullPath: string, entry: fs.Dirent, toolkitRealRoot?: string, visited?: Set<string>,
  ): Promise<{ isFile: boolean; isDirectory: boolean }> {
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.promises.stat(fullPath);
        const realPath = await fs.promises.realpath(fullPath);
        if (stat.isDirectory() && toolkitRealRoot) {
          const norm = realPath.replace(/\\/g, '/').toLowerCase();
          const root = toolkitRealRoot.replace(/\\/g, '/').toLowerCase();
          if (norm !== root && !norm.startsWith(root + '/')) return { isFile: false, isDirectory: false };
        }
        if (stat.isDirectory() && visited) {
          const key = realPath.replace(/\\/g, '/').toLowerCase();
          if (visited.has(key)) return { isFile: false, isDirectory: false };
          visited.add(key);
        }
        return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
      } catch { return { isFile: false, isDirectory: false }; }
    }
    return { isFile: entry.isFile(), isDirectory: entry.isDirectory() };
  }

  private async readDirSafe(dirPath: string): Promise<fs.Dirent[]> {
    try {
      return await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Cannot read directory ${dirPath}:`, err);
      return [];
    }
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try { return (await fs.promises.stat(dirPath)).isDirectory(); } catch { return false; }
}
