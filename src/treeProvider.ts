import * as vscode from 'vscode';
import { Asset, PinRecord, Toolkit } from './types';
import { AssetFolderGroup, buildToolkitFolderLayout, countFolderAssets } from './treeModel';

/** Minimal surface the tree provider needs from PinManager. */
export interface PinStateProvider {
  findPinRecord(asset: Asset): PinRecord | undefined;
}

/**
 * Tree node types for the sidebar. The tree mirrors the toolkit layout:
 *  - Section nodes partition toolkits by kind
 *  - Toolkits expand into real folder nodes
 *  - Folder-based assets expand into their child files
 */
export type TreeNode = SectionNode | ToolkitNode | FolderNode | AssetNode;

export interface SectionNode {
  kind: 'section';
  label: string;
  id: 'toolkits' | 'plugins' | 'groups';
  toolkits: Toolkit[];
}

export interface ToolkitNode {
  kind: 'toolkit';
  toolkit: Toolkit;
}

export interface FolderNode {
  kind: 'folder';
  folder: AssetFolderGroup;
  toolkit: Toolkit;
  toolkitEnabled: boolean;
}

export interface AssetNode {
  kind: 'asset';
  asset: Asset;
  toolkit: Toolkit;
  toolkitEnabled: boolean;
  nested: boolean;
}

const ASSET_TYPE_LABELS = new Map<string, string>([
  ['agents', 'Agents'], ['instructions', 'Instructions'], ['skills', 'Skills'],
  ['prompts', 'Prompts'], ['plugins', 'Plugins'], ['commands', 'Commands'], ['hooks', 'Hooks'],
  ['workflows', 'Workflows'], ['standards', 'Standards'], ['mcps', 'MCP Servers'], ['docs', 'Docs'],
]);

const ASSET_TYPE_ICONS = new Map<string, string>([
  ['agents', 'robot'], ['instructions', 'book'], ['skills', 'tools'],
  ['prompts', 'comment-discussion'], ['plugins', 'extensions'], ['commands', 'terminal'], ['hooks', 'zap'],
  ['workflows', 'play-circle'], ['standards', 'law'], ['mcps', 'plug'], ['docs', 'file-text'],
]);

function getAssetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS.get(type) ?? (type.charAt(0).toUpperCase() + type.slice(1));
}

function getAssetTypeIcon(type: string): string {
  return ASSET_TYPE_ICONS.get(type) ?? 'file';
}

function getFolderLabel(name: string): string {
  return getAssetTypeLabel(name);
}

function getFolderIcon(folder: AssetFolderGroup): string {
  const lastSegment = folder.relativePath.split('/').filter(Boolean).at(-1) ?? folder.name;
  if (ASSET_TYPE_ICONS.has(lastSegment)) {
    return getAssetTypeIcon(lastSegment);
  }
  return 'folder';
}

export class ToolkitTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private toolkits: Toolkit[] = [];
  private pinProvider: PinStateProvider | undefined;

  setPinProvider(provider: PinStateProvider): void { this.pinProvider = provider; }

  dispose(): void { this._onDidChangeTreeData.dispose(); }
  refresh(): void { this._onDidChangeTreeData.fire(); }

  setToolkits(toolkitsBySource: Map<string, Toolkit[]>): void {
    // Flatten to a single list — the SourceNode hierarchy added noise.
    const flat: Toolkit[] = [];
    for (const tks of toolkitsBySource.values()) { flat.push(...tks); }
    this.toolkits = flat;
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'section': return this.getSectionItem(element);
      case 'toolkit': return this.getToolkitItem(element);
      case 'folder': return this.getFolderItem(element);
      case 'asset': return this.getAssetItem(element);
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) { return this.getRootChildren(); }
    switch (element.kind) {
      case 'section':
        return element.toolkits.map(toolkit => ({ kind: 'toolkit' as const, toolkit }));
      case 'toolkit':
        return this.toTreeNodes(buildToolkitFolderLayout(element.toolkit.assets), element.toolkit, element.toolkit.enabled, false);
      case 'folder':
        return this.toTreeNodes(element.folder, element.toolkit, element.toolkitEnabled, false);
      case 'asset': {
        const asset = element.asset;
        if (asset.isFolder && asset.children) {
          return asset.children.map(child => ({
            kind: 'asset' as const,
            asset: child,
            toolkit: element.toolkit,
            toolkitEnabled: element.toolkitEnabled,
            nested: true,
          }));
        }
        return [];
      }
    }
  }

  getParent(_element: TreeNode): TreeNode | undefined { return undefined; }

  private getRootChildren(): TreeNode[] {
    const nodes: TreeNode[] = [];

    // Partition toolkits into plugins, pick-groups, and regular.
    const plugins = this.toolkits.filter(t => t.isPlugin && !t.isPinGroup);
    const groups = this.toolkits.filter(t => t.isPinGroup);
    const regular = this.toolkits.filter(t => !t.isPinGroup && !t.isPlugin);

    if (regular.length > 0) {
      nodes.push({ kind: 'section', label: 'Toolkits', id: 'toolkits', toolkits: regular });
    }
    if (plugins.length > 0) {
      nodes.push({ kind: 'section', label: 'Plugins', id: 'plugins', toolkits: plugins });
    }
    if (groups.length > 0) {
      nodes.push({ kind: 'section', label: 'Pick Groups', id: 'groups', toolkits: groups });
    }

    return nodes;
  }

  // --- rendering ---

  private getSectionItem(node: SectionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    const enabled = node.toolkits.filter(t => t.enabled).length;
    item.description = `${enabled}/${node.toolkits.length}`;
    const sectionIcon = node.id === 'groups' ? 'pinned' : node.id === 'plugins' ? 'extensions' : 'library';
    item.iconPath = new vscode.ThemeIcon(sectionIcon);
    item.contextValue = `section-${node.id}`;
    return item;
  }

  private getToolkitItem(node: ToolkitNode): vscode.TreeItem {
    const tk = node.toolkit;
    const item = new vscode.TreeItem(tk.name, vscode.TreeItemCollapsibleState.Collapsed);

    const color = tk.enabled ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('disabledForeground');
    const iconId = this.getToolkitIcon(tk);
    item.iconPath = new vscode.ThemeIcon(iconId, color);

    item.description = tk.update?.updateAvailable ? 'Update available' : undefined;

    const copilotN = tk.assets.filter(a => a.platform === 'copilot').length;
    const claudeN = tk.assets.filter(a => a.platform === 'claude').length;
    const bothN = tk.assets.filter(a => a.platform === 'both').length;
    const sharedN = tk.assets.filter(a => a.platform === 'shared').length;
    const platformParts: string[] = [];
    if (copilotN > 0) { platformParts.push(`Copilot:${copilotN}`); }
    if (claudeN > 0) { platformParts.push(`Claude:${claudeN}`); }
    if (bothN > 0) { platformParts.push(`Both:${bothN}`); }
    if (sharedN > 0) { platformParts.push(`Shared:${sharedN}`); }

    const toolTipLines = [
      tk.name,
      tk.enabled ? 'Active for discovery' : 'Inactive',
      `${tk.assets.length} asset${tk.assets.length === 1 ? '' : 's'}`,
    ];
    if (platformParts.length > 0) {
      toolTipLines.push(`Assets: ${platformParts.join(', ')}`);
    }
    if (tk.isPinGroup) { toolTipLines.push('Type: Pick group'); }
    else if (tk.isPlugin) { toolTipLines.push('Type: Claude Code plugin'); }
    else if (tk.isCloned) { toolTipLines.push('Type: Cloned from GitHub'); }
    else { toolTipLines.push('Type: Local folder'); }
    toolTipLines.push(tk.rootPath);
    if (tk.update?.updateAvailable) {
      const r = tk.update.remoteSha ? `..${tk.update.remoteSha}` : '';
      toolTipLines.push(`Update: ${tk.update.currentSha}${r} (${tk.update.behindCount ?? '?'} behind)`);
    }
    item.tooltip = toolTipLines.join('\n');

    // Context values are a public contract with package.json menus and tests.
    // Keep suffix changes synchronized with the view/item/context regexes.
    const state = tk.enabled ? 'enabled' : 'disabled';
    const source = tk.isPinGroup ? 'group' : (tk.isCloned ? 'cloned' : 'external');
    const updatable = tk.update?.updateAvailable ? '-updatable' : '';
    item.contextValue = `toolkit-${state}-${source}${updatable}`;
    return item;
  }

  private getToolkitIcon(tk: Toolkit): string {
    if (tk.isPinGroup) { return tk.enabled ? 'pinned' : 'pin'; }
    if (tk.isPlugin) { return 'extensions'; }
    if (tk.isCloned) { return tk.update?.updateAvailable ? 'cloud-download' : 'cloud'; }
    return 'folder-library';
  }

  private getFolderItem(node: FolderNode): vscode.TreeItem {
    const item = new vscode.TreeItem(getFolderLabel(node.folder.name), vscode.TreeItemCollapsibleState.Collapsed);
    const color = node.toolkitEnabled ? undefined : new vscode.ThemeColor('disabledForeground');
    item.iconPath = new vscode.ThemeIcon(getFolderIcon(node.folder), color);
    item.tooltip = `${node.folder.relativePath}\n${countFolderAssets(node.folder)} asset${countFolderAssets(node.folder) === 1 ? '' : 's'}`;
    if (node.folder.folders.length === 0) {
      item.description = `${countFolderAssets(node.folder)}`;
    }
    return item;
  }

  private getAssetItem(node: AssetNode): vscode.TreeItem {
    const asset = node.asset;
    const hasChildren = asset.isFolder && Array.isArray(asset.children) && asset.children.length > 0;
    const state = hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(asset.name, state);

    const pinRecord = this.pinProvider?.findPinRecord(asset);
    const isPinned = !!pinRecord;

    const base = node.nested ? 'asset-child' : (node.toolkitEnabled ? 'asset-enabled' : 'asset-disabled');
    const pinnedSuffix = isPinned ? '-pinned' : '';
    item.contextValue = `${base}${pinnedSuffix}`;

    if (!hasChildren) {
      item.command = {
        command: 'aiToolkit.openAsset',
        title: 'Open Asset',
        arguments: [asset],
      };
    }

    const toolTipLines = [asset.sourcePath];
    if (isPinned) {
      toolTipLines.unshift(`Pinned in group: ${pinRecord!.groupName}`);
    }
    if (!node.nested) {
      toolTipLines.unshift(node.toolkitEnabled ? 'Active via toolkit' : 'Inactive via toolkit');
    }
    item.tooltip = toolTipLines.join('\n');

    const iconColor = node.toolkitEnabled ? undefined : new vscode.ThemeColor('disabledForeground');
    if (isPinned) {
      item.iconPath = new vscode.ThemeIcon('pinned', iconColor ?? new vscode.ThemeColor('charts.purple'));
    } else {
      item.iconPath = new vscode.ThemeIcon(asset.isFolder ? 'folder' : 'file', iconColor);
    }

    return item;
  }

  private toTreeNodes(
    layout: { folders: AssetFolderGroup[]; assets: Asset[] },
    toolkit: Toolkit,
    toolkitEnabled: boolean,
    nested: boolean,
  ): TreeNode[] {
    return [
      ...layout.folders.map(folder => ({
        kind: 'folder' as const,
        folder,
        toolkit,
        toolkitEnabled,
      })),
      ...layout.assets.map(asset => ({
        kind: 'asset' as const,
        asset,
        toolkit,
        toolkitEnabled,
        nested,
      })),
    ];
  }

  getPinRecord(asset: Asset): PinRecord | undefined {
    return this.pinProvider?.findPinRecord(asset);
  }
}
