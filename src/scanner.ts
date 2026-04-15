import * as fs from 'fs';
import * as path from 'path';
import { pathExists, toToolkitId } from './pathUtils';
import { Asset, AssetMapping, AssetPlatform, AssetType, SourceFormat, Toolkit, ToolkitManifest } from './types';

/**
 * Maximum recursive depth when walking a toolkit's asset folders.
 * This is a DoS guard against symlink loops (a malicious toolkit repo
 * with circular symlinks could otherwise hang the scanner). Real toolkits
 * never have legitimate content past depth 5. Not exposed as a setting —
 * if you need to exceed it, the toolkit layout is probably wrong.
 */
const MAX_SCAN_DEPTH = 5;
const EXCLUDED_FILENAMES = new Set([
  'readme.md', 'changelog.md', 'license.md', 'contributing.md',
]);

/**
 * Mappings used when scanning a sideloaded Claude Code plugin folder.
 * Plugin layout is flat (agents/, commands/, skills/, hooks/) directly under the root,
 * not nested under copilot/ or claude/ like a DualPlatform toolkit.
 */
export const PLUGIN_ASSET_MAPPINGS: AssetMapping[] = [
  { folder: 'agents',   assetType: AssetType.Agent,   platform: 'claude', isFolder: false, extensions: ['.md'] },
  { folder: 'commands', assetType: AssetType.Command, platform: 'claude', isFolder: false, extensions: ['.md'] },
  { folder: 'skills',   assetType: AssetType.Skill,   platform: 'claude', isFolder: true },
  { folder: 'hooks',    assetType: AssetType.Hook,    platform: 'claude', isFolder: false, extensions: ['.json'] },
];

/**
 * Mappings used when scanning a flat-layout toolkit (type folders directly under
 * the root, no copilot/claude/shared prefix). This matches pin-group layout
 * (`<picksDir>/<group>/<type>/<asset>`) and similar third-party collections.
 */
export const FLAT_ASSET_MAPPINGS: AssetMapping[] = [
  // Top-level (awesome-copilot, pin groups, ad-hoc collections).
  { folder: 'agents',       assetType: AssetType.Agent,       platform: 'copilot', isFolder: false, extensions: ['.agent.md', '.md'] },
  { folder: 'instructions', assetType: AssetType.Instruction, platform: 'copilot', isFolder: false, extensions: ['.instructions.md', '.md'] },
  { folder: 'prompts',      assetType: AssetType.Prompt,      platform: 'copilot', isFolder: false, extensions: ['.prompt.md', '.md'] },
  { folder: 'plugins',      assetType: AssetType.Plugin,      platform: 'copilot', isFolder: true },
  { folder: 'workflows',    assetType: AssetType.Workflow,    platform: 'copilot', isFolder: false, extensions: ['.md'] },
  { folder: 'commands',     assetType: AssetType.Command,     platform: 'claude',  isFolder: false, extensions: ['.md'] },
  { folder: 'skills',       assetType: AssetType.Skill,       platform: 'both',    isFolder: true },
  { folder: 'hooks',        assetType: AssetType.Hook,        platform: 'claude',  isFolder: false, extensions: ['.json'] },
  { folder: 'mcps',         assetType: AssetType.McpServer,   platform: 'claude',  isFolder: false, extensions: ['.json'] },
  { folder: 'standards',    assetType: AssetType.Standard,    platform: 'shared',  isFolder: true },
  { folder: 'docs',         assetType: AssetType.Doc,         platform: 'shared',  isFolder: false, extensions: ['.md'] },
  // Legacy CopilotCustomizer layout (assets under .github/).
  { folder: '.github/agents',       assetType: AssetType.Agent,       platform: 'copilot', isFolder: false, extensions: ['.agent.md', '.md'] },
  { folder: '.github/instructions', assetType: AssetType.Instruction, platform: 'copilot', isFolder: false, extensions: ['.instructions.md', '.md'] },
  { folder: '.github/prompts',      assetType: AssetType.Prompt,      platform: 'copilot', isFolder: false, extensions: ['.prompt.md', '.md'] },
  { folder: '.github/workflows',    assetType: AssetType.Workflow,    platform: 'copilot', isFolder: false, extensions: ['.md'] },
  { folder: '.github/standards',    assetType: AssetType.Standard,    platform: 'shared',  isFolder: true },
];

type FolderKind = 'dual' | 'plugin' | 'flat';

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

    // Top-level: is the user-added folder itself a toolkit?
    const kind = await this.classifyFolder(resolved, mappings);
    if (kind) {
      const toolkit = await this.scanByKind(kind, resolved, mappings, enabledToolkits);
      return toolkit ? [toolkit] : [];
    }

    // Otherwise, treat it as a container and look one level deeper.
    const toolkits: Toolkit[] = [];
    const entries = await this.readDirSafe(resolved);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const subPath = path.join(resolved, entry.name);
      const subKind = await this.classifyFolder(subPath, mappings);
      if (!subKind) continue;
      const toolkit = await this.scanByKind(subKind, subPath, mappings, enabledToolkits);
      if (toolkit) toolkits.push(toolkit);
    }
    if (toolkits.length > 0) return toolkits;

    // Sideload fallback: a single skill folder (no recognizable toolkit shape).
    const sideloaded = await this.scanAsSideloadedFolder(resolved, enabledToolkits);
    return sideloaded ? [sideloaded] : [];
  }

  private async classifyFolder(dirPath: string, mappings: AssetMapping[]): Promise<FolderKind | null> {
    // Classification order matters. The fallback chain when this returns null
    // is: caller treats it as a container and descends one level, or (for
    // leaf folders) calls scanAsSideloadedFolder to register a single skill.
    // Specifically: SKILL.md at root short-circuits to null so the caller's
    // sideload path handles it, rather than us misreading the folder as flat
    // layout when it also happens to have an empty `skills/` subdir.
    if (await pathExists(path.join(dirPath, '.claude-plugin', 'plugin.json'))) return 'plugin';
    if (await this.isDualPlatformToolkit(dirPath, mappings)) return 'dual';
    if (await pathExists(path.join(dirPath, 'SKILL.md'))) return null;
    if (await this.isFlatLayoutToolkit(dirPath)) return 'flat';
    return null;
  }

  private async scanByKind(
    kind: FolderKind, dirPath: string, mappings: AssetMapping[],
    enabledToolkits: Record<string, boolean>,
  ): Promise<Toolkit | null> {
    switch (kind) {
      case 'dual': return this.scanToolkit(dirPath, mappings, enabledToolkits);
      case 'plugin': {
        const tk = await this.scanToolkit(dirPath, PLUGIN_ASSET_MAPPINGS, enabledToolkits);
        if (tk) { tk.isPlugin = true; tk.format = SourceFormat.Sideloaded; return tk; }
        // Empty plugin folder — still surface so the user knows it was detected.
        const id = toToolkitId(dirPath);
        return {
          id, name: path.basename(dirPath), rootPath: dirPath,
          format: SourceFormat.Sideloaded, assets: [],
          enabled: enabledToolkits[id] ?? false, isPlugin: true,
        };
      }
      case 'flat': {
        const tk = await this.scanToolkit(dirPath, FLAT_ASSET_MAPPINGS, enabledToolkits);
        if (tk) { tk.format = SourceFormat.Sideloaded; }
        return tk;
      }
    }
  }

  private async isDualPlatformToolkit(dirPath: string, mappings: AssetMapping[]): Promise<boolean> {
    const topFolders = new Set(mappings.map(m => m.folder.split('/')[0]));
    for (const folder of topFolders) {
      if (await isDirectory(path.join(dirPath, folder))) return true;
    }
    return false;
  }

  private async isFlatLayoutToolkit(dirPath: string): Promise<boolean> {
    // `workflows` / `.github/workflows` alone is not enough to classify a folder
    // as a flat-layout toolkit — virtually every GitHub repo has a CI workflows
    // directory, so matching on it produces false positives when the user points
    // the scanner at an ordinary container of repos. We require at least one
    // primary asset folder (agents, instructions, prompts, plugins, commands,
    // skills, hooks, mcps, standards, docs) to match.
    for (const mapping of FLAT_ASSET_MAPPINGS) {
      if (mapping.folder === 'workflows' || mapping.folder === '.github/workflows') continue;
      if (await isDirectory(path.join(dirPath, mapping.folder))) return true;
    }
    return false;
  }

  /**
   * Attempts to treat a single folder as one sideloaded skill. Only fires
   * when `classifyFolder` has returned null (not a plugin / dual / flat
   * layout). Requires SKILL.md at the folder root; any other folder shape
   * is rejected to avoid registering arbitrary directories as fake skills.
   */
  private async scanAsSideloadedFolder(
    folderPath: string,
    enabledToolkits: Record<string, boolean>,
  ): Promise<Toolkit | null> {
    const entries = await this.readDirSafe(folderPath);
    // Skip if the folder is entirely empty or contains only hidden files.
    if (!entries.some(e => !e.name.startsWith('.'))) return null;

    // Only register folders that actually look like a skill.
    if (!(await pathExists(path.join(folderPath, 'SKILL.md')))) return null;

    const id = toToolkitId(folderPath);
    const name = path.basename(folderPath);

    let realRoot: string;
    try {
      realRoot = (await fs.promises.realpath(folderPath)).replace(/\\/g, '/').toLowerCase();
    } catch {
      realRoot = folderPath.replace(/\\/g, '/').toLowerCase();
    }

    const children = await this.scanFolderContents(
      folderPath, AssetType.Skill, 'both', `${id}::${name}`, name,
      MAX_SCAN_DEPTH - 1, realRoot, new Set(),
    );

    const asset: Asset = {
      id: `${id}::${name}`,
      name,
      type: AssetType.Skill,
      sourcePath: folderPath,
      relativePath: name,
      isFolder: true,
      platform: 'both',
      children,
    };

    return {
      id,
      name,
      rootPath: folderPath,
      format: SourceFormat.Sideloaded,
      assets: [asset],
      enabled: enabledToolkits[id] ?? false,
    };
  }

  private async scanToolkit(
    rootPath: string,
    mappings: AssetMapping[],
    enabledToolkits: Record<string, boolean>,
  ): Promise<Toolkit | null> {
    const id = toToolkitId(rootPath);
    const manifest = await this.loadManifest(rootPath);
    // Per-toolkit manifest mappings are additive — they extend but cannot override
    // the extension-level defaults. This prevents a broken or malicious manifest
    // from disabling the user's configured asset discovery.
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
    const visitedLinks = new Set<string>();
    const assets: Asset[] = [];
    const seenIds = new Set<string>();

    for (const mapping of effectiveMappings) {
      const folderPath = path.join(rootPath, ...mapping.folder.split('/'));
      if (!(await pathExists(folderPath))) continue;
      const discovered = await this.scanMappingFolder(
        folderPath, mapping, id, mapping.folder, MAX_SCAN_DEPTH, toolkitRealRoot, visitedLinks,
      );
      for (const asset of discovered) {
        if (!seenIds.has(asset.id)) { seenIds.add(asset.id); assets.push(asset); }
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
          const children = await this.scanFolderContents(fullPath, mapping.assetType, mapping.platform, assetId, relativePath, depth - 1, toolkitRealRoot, visited);
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
    folderPath: string, type: AssetType, platform: AssetPlatform, parentId: string, parentRelPath: string,
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
        const nested = await this.scanFolderContents(fullPath, type, platform, parentId, relativePath, depth - 1, toolkitRealRoot, visited);
        if (nested.length > 0) {
          children.push({ id: `${toolkitId}::${relativePath}`, name: entry.name, type, sourcePath: fullPath, relativePath, isFolder: true, platform, children: nested });
        }
      } else if (kind.isFile) {
        children.push({ id: `${toolkitId}::${relativePath}`, name: entry.name, type, sourcePath: fullPath, relativePath, isFolder: false, platform });
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
