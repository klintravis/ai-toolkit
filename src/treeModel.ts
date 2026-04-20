import { Asset } from './types';

const ASSET_TYPE_LABELS = new Map<string, string>([
  ['agents', 'Agents'], ['instructions', 'Instructions'], ['skills', 'Skills'],
  ['prompts', 'Prompts'], ['plugins', 'Plugins'], ['commands', 'Commands'], ['hooks', 'Hooks'],
  ['workflows', 'Workflows'], ['standards', 'Standards'], ['mcps', 'MCP Servers'], ['docs', 'Docs'],
]);

const COLLAPSED_ROOT_PREFIXES = new Set(['copilot', 'claude', 'shared', '.github']);

export interface AssetFolderGroup {
  name: string;
  relativePath: string;
  folders: AssetFolderGroup[];
  assets: Asset[];
}

export interface ToolkitFolderLayout {
  folders: AssetFolderGroup[];
  assets: Asset[];
}

interface MutableAssetFolderGroup extends AssetFolderGroup {
  folders: MutableAssetFolderGroup[];
  folderMap: Map<string, MutableAssetFolderGroup>;
}

function getAssetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS.get(type) ?? (type.charAt(0).toUpperCase() + type.slice(1));
}

function getRootSegments(folderParts: string[]): string[] {
  if (folderParts.length >= 2 && COLLAPSED_ROOT_PREFIXES.has(folderParts[0])) {
    return folderParts.slice(0, 2);
  }
  return folderParts.slice(0, 1);
}

function getDefaultRootLabel(rootSegments: string[]): string {
  return getAssetTypeLabel(rootSegments[rootSegments.length - 1]);
}

function getExpandedRootLabel(rootSegments: string[]): string {
  const [first, second] = rootSegments;
  if (!second) {
    return getAssetTypeLabel(first);
  }

  const assetLabel = getAssetTypeLabel(second);
  switch (first) {
    case 'copilot': return `Copilot ${assetLabel}`;
    case 'claude': return `Claude ${assetLabel}`;
    case 'shared': return `Shared ${assetLabel}`;
    case '.github': return `GitHub ${assetLabel}`;
    default: return `${getAssetTypeLabel(first)} ${assetLabel}`;
  }
}

function createFolderGroup(name: string, relativePath: string): MutableAssetFolderGroup {
  return {
    name,
    relativePath,
    folders: [],
    assets: [],
    folderMap: new Map<string, MutableAssetFolderGroup>(),
  };
}

function finalizeFolderGroup(folder: MutableAssetFolderGroup): AssetFolderGroup {
  return {
    name: folder.name,
    relativePath: folder.relativePath,
    folders: folder.folders.map(finalizeFolderGroup),
    assets: folder.assets,
  };
}

export function buildToolkitFolderLayout(assets: Asset[]): ToolkitFolderLayout {
  const rootFolders = new Map<string, MutableAssetFolderGroup>();
  const rootAssets: Asset[] = [];

  for (const asset of assets) {
    const parts = asset.relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    const folderParts = parts.slice(0, -1);

    if (folderParts.length === 0) {
      rootAssets.push(asset);
      continue;
    }

    const rootSegments = getRootSegments(folderParts);
    const rootRelativePath = rootSegments.join('/');
    let currentFolder = rootFolders.get(rootRelativePath);

    if (!currentFolder) {
      currentFolder = createFolderGroup(getDefaultRootLabel(rootSegments), rootRelativePath);
      rootFolders.set(rootRelativePath, currentFolder);
    }

    let currentMap = currentFolder.folderMap;
    let currentPath = rootRelativePath;

    for (const segment of folderParts.slice(rootSegments.length)) {
      const relativePath = currentPath ? `${currentPath}/${segment}` : segment;
      let folder = currentMap.get(segment);

      if (!folder) {
        folder = createFolderGroup(segment, relativePath);
        currentMap.set(segment, folder);
        currentFolder.folders.push(folder);
      }

      currentFolder = folder;
      currentMap = folder.folderMap;
      currentPath = relativePath;
    }

    currentFolder.assets.push(asset);
  }

  const finalizedRoots = Array.from(rootFolders.values());
  const labelCounts = new Map<string, number>();

  for (const folder of finalizedRoots) {
    labelCounts.set(folder.name, (labelCounts.get(folder.name) ?? 0) + 1);
  }

  for (const folder of finalizedRoots) {
    if ((labelCounts.get(folder.name) ?? 0) > 1) {
      folder.name = getExpandedRootLabel(folder.relativePath.split('/').filter(Boolean));
    }
  }

  return {
    folders: finalizedRoots.map(finalizeFolderGroup),
    assets: rootAssets,
  };
}

export function countFolderAssets(folder: AssetFolderGroup): number {
  return folder.assets.length + folder.folders.reduce((sum, child) => sum + countFolderAssets(child), 0);
}