import * as vscode from 'vscode';
import { Asset, AssetType, PinRecord, Toolkit } from './types';

/** Minimal surface the tree provider needs from PinManager. */
export interface PinStateProvider {
  isPinsToolkit(toolkit: Toolkit): boolean;
  findPinRecord(asset: Asset): PinRecord | undefined;
}

/**
 * Tree node types for the sidebar. The tree is intentionally shallow:
 *  - Overview header (clickable → dashboard)
 *  - Flat list of toolkit nodes (each one has inline enable/disable)
 *  - Toolkits are collapsed by default; expand to browse assets
 */
export type TreeNode = OverviewNode | SectionNode | ToolkitNode | AssetTypeNode | AssetNode;

export interface OverviewNode {
  kind: 'overview';
  activeToolkits: number;
  totalToolkits: number;
  pinnedAssets: number;
  updatesAvailable: number;
}

export interface SectionNode {
  kind: 'section';
  label: string;
  id: 'toolkits' | 'groups';
  toolkits: Toolkit[];
}

export interface ToolkitNode {
  kind: 'toolkit';
  toolkit: Toolkit;
}

export interface AssetTypeNode {
  kind: 'assetType';
  type: AssetType;
  label: string;
  assets: Asset[];
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
  ['prompts', 'Prompts'], ['plugins', 'Plugins'], ['hooks', 'Hooks'],
  ['workflows', 'Workflows'], ['standards', 'Standards'], ['mcps', 'MCP Servers'], ['docs', 'Docs'],
]);

const ASSET_TYPE_ICONS = new Map<string, string>([
  ['agents', 'robot'], ['instructions', 'book'], ['skills', 'tools'],
  ['prompts', 'comment-discussion'], ['plugins', 'extensions'], ['hooks', 'zap'],
  ['workflows', 'play-circle'], ['standards', 'law'], ['mcps', 'plug'], ['docs', 'file-text'],
]);

function getAssetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS.get(type) ?? (type.charAt(0).toUpperCase() + type.slice(1));
}

function getAssetTypeIcon(type: string): string {
  return ASSET_TYPE_ICONS.get(type) ?? 'file';
}

function getPlatformBadge(platform: string | undefined): string {
  switch (platform) {
    case 'both': return '[Both]';
    case 'claude': return '[Claude]';
    case 'shared': return '[Shared]';
    default: return '';
  }
}

export class ToolkitTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private toolkits: Toolkit[] = [];
  private pinProvider: PinStateProvider | undefined;
  private pinRecords: PinRecord[] = [];
  private summary = { activeToolkits: 0, updatesAvailable: 0 };

  setPinProvider(provider: PinStateProvider): void { this.pinProvider = provider; }
  setPinRecords(records: PinRecord[]): void { this.pinRecords = records; this.refresh(); }
  setSummary(summary: { activeToolkits: number; updatesAvailable: number }): void {
    this.summary = summary; this.refresh();
  }

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
      case 'overview': return this.getOverviewItem(element);
      case 'section': return this.getSectionItem(element);
      case 'toolkit': return this.getToolkitItem(element);
      case 'assetType': return this.getAssetTypeItem(element);
      case 'asset': return this.getAssetItem(element);
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) { return this.getRootChildren(); }
    switch (element.kind) {
      case 'overview': return [];
      case 'section':
        return element.toolkits.map(toolkit => ({ kind: 'toolkit' as const, toolkit }));
      case 'toolkit': {
        const grouped = this.groupByType(element.toolkit.assets);
        return Array.from(grouped.entries()).map(([type, assets]) => ({
          kind: 'assetType' as const,
          type,
          label: getAssetTypeLabel(type),
          assets,
          toolkit: element.toolkit,
          toolkitEnabled: element.toolkit.enabled,
        }));
      }
      case 'assetType':
        return element.assets.map(asset => ({
          kind: 'asset' as const,
          asset, toolkit: element.toolkit,
          toolkitEnabled: element.toolkitEnabled,
          nested: false,
        }));
      case 'asset':
        if (element.asset.isFolder && element.asset.children && element.asset.children.length > 0) {
          return element.asset.children.map(child => ({
            kind: 'asset' as const,
            asset: child, toolkit: element.toolkit,
            toolkitEnabled: element.toolkitEnabled,
            nested: true,
          }));
        }
        return [];
    }
  }

  getParent(_element: TreeNode): TreeNode | undefined { return undefined; }

  private getRootChildren(): TreeNode[] {
    const nodes: TreeNode[] = [];

    // Overview header — click to open dashboard.
    nodes.push({
      kind: 'overview',
      activeToolkits: this.summary.activeToolkits,
      totalToolkits: this.toolkits.length,
      pinnedAssets: this.pinRecords.length,
      updatesAvailable: this.summary.updatesAvailable,
    });

    // Partition toolkits into pick-groups vs regular.
    const groups = this.toolkits.filter(t => t.isPinGroup);
    const regular = this.toolkits.filter(t => !t.isPinGroup);

    if (regular.length > 0) {
      nodes.push({ kind: 'section', label: 'Toolkits', id: 'toolkits', toolkits: regular });
    }
    if (groups.length > 0) {
      nodes.push({ kind: 'section', label: 'Pick Groups', id: 'groups', toolkits: groups });
    }

    return nodes;
  }

  // --- rendering ---

  private getOverviewItem(node: OverviewNode): vscode.TreeItem {
    const item = new vscode.TreeItem('Dashboard', vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('dashboard', new vscode.ThemeColor('charts.blue'));
    const chips: string[] = [];
    chips.push(`${node.activeToolkits}/${node.totalToolkits} active`);
    if (node.pinnedAssets > 0) { chips.push(`📌 ${node.pinnedAssets}`); }
    if (node.updatesAvailable > 0) { chips.push(`🔔 ${node.updatesAvailable}`); }
    item.description = chips.join(' · ');
    item.tooltip = 'Click to open the AI Toolkit dashboard';
    item.contextValue = 'overview';
    item.command = { command: 'aiToolkit.openDashboard', title: 'Open Dashboard' };
    return item;
  }

  private getSectionItem(node: SectionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    const enabled = node.toolkits.filter(t => t.enabled).length;
    item.description = `${enabled}/${node.toolkits.length}`;
    item.iconPath = new vscode.ThemeIcon(node.id === 'groups' ? 'pinned' : 'library');
    item.contextValue = `section-${node.id}`;
    return item;
  }

  private getToolkitItem(node: ToolkitNode): vscode.TreeItem {
    const tk = node.toolkit;
    const item = new vscode.TreeItem(tk.name, vscode.TreeItemCollapsibleState.Collapsed);

    // Icon with accent color based on state + type.
    const color = tk.enabled
      ? new vscode.ThemeColor(tk.update?.updateAvailable ? 'charts.yellow' : 'charts.green')
      : new vscode.ThemeColor('disabledForeground');
    const iconId = this.getToolkitIcon(tk);
    item.iconPath = new vscode.ThemeIcon(iconId, color);

    // Description: clean status line with unicode indicators.
    const parts: string[] = [];
    parts.push(tk.enabled ? '● on' : '○ off');
    const copilotN = tk.assets.filter(a => a.platform === 'copilot').length;
    const claudeN = tk.assets.filter(a => a.platform === 'claude').length;
    const bothN = tk.assets.filter(a => a.platform === 'both').length;
    const sharedN = tk.assets.filter(a => a.platform === 'shared').length;
    const platformParts: string[] = [];
    if (copilotN > 0) { platformParts.push(`Copilot:${copilotN}`); }
    if (claudeN > 0) { platformParts.push(`Claude:${claudeN}`); }
    if (bothN > 0) { platformParts.push(`Both:${bothN}`); }
    if (sharedN > 0) { platformParts.push(`Shared:${sharedN}`); }
    parts.push(platformParts.length > 0 ? platformParts.join(' | ') : `${tk.assets.length}`);
    if (tk.update?.updateAvailable) { parts.push(`🔔 ${tk.update.behindCount ?? ''}`.trim()); }
    item.description = parts.join(' · ');

    // Tooltip.
    const toolTipLines = [
      tk.name,
      `${tk.assets.length} asset${tk.assets.length === 1 ? '' : 's'}`,
      tk.enabled ? 'Enabled for Copilot discovery' : 'Disabled',
    ];
    if (tk.isPinGroup) { toolTipLines.push('Type: Pick group'); }
    else if (tk.isCloned) { toolTipLines.push('Type: Cloned from GitHub'); }
    else { toolTipLines.push('Type: Local folder'); }
    toolTipLines.push(tk.rootPath);
    if (tk.update?.updateAvailable) {
      const r = tk.update.remoteSha ? `..${tk.update.remoteSha}` : '';
      toolTipLines.push(`Update: ${tk.update.currentSha}${r} (${tk.update.behindCount ?? '?'} behind)`);
    }
    item.tooltip = toolTipLines.join('\n');

    // Context: toolkit-{enabled|disabled}-{cloned|group|external}[-updatable]
    const state = tk.enabled ? 'enabled' : 'disabled';
    const source = tk.isPinGroup ? 'group' : (tk.isCloned ? 'cloned' : 'external');
    const updatable = tk.update?.updateAvailable ? '-updatable' : '';
    item.contextValue = `toolkit-${state}-${source}${updatable}`;
    return item;
  }

  private getToolkitIcon(tk: Toolkit): string {
    if (tk.isPinGroup) { return tk.enabled ? 'pinned' : 'pin'; }
    if (tk.isCloned) { return tk.update?.updateAvailable ? 'cloud-download' : 'cloud'; }
    return 'folder-library';
  }

  private getAssetTypeItem(node: AssetTypeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon(getAssetTypeIcon(node.type));
    item.description = `${node.assets.length}`;
    return item;
  }

  private getAssetItem(node: AssetNode): vscode.TreeItem {
    const asset = node.asset;
    const hasChildren = asset.isFolder && !!asset.children && asset.children.length > 0;
    const collapsibleState = hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(asset.name, collapsibleState);
    item.tooltip = asset.sourcePath;

    // Determine pinned state — top-level only.
    const pinRecord = !node.nested ? this.pinProvider?.findPinRecord(asset) : undefined;
    const isPinned = !!pinRecord;

    const base = node.toolkitEnabled ? 'asset-enabled' : 'asset-disabled';
    const pinnedSuffix = isPinned ? '-pinned' : '';
    const nestedSuffix = node.nested ? '-nested' : '';
    item.contextValue = `${base}${pinnedSuffix}${nestedSuffix}`;

    if (!asset.isFolder) {
      item.command = {
        command: 'aiToolkit.openAsset',
        title: 'Open Asset',
        arguments: [asset],
      };
    }

    const badge = !node.nested ? getPlatformBadge(asset.platform) : '';
    const descParts: string[] = [];
    if (hasChildren) { descParts.push(`${asset.children!.length}`); }
    if (isPinned) { descParts.push(`📌 ${pinRecord!.groupName}`); }
    if (badge) { descParts.push(badge); }
    if (descParts.length > 0) { item.description = descParts.join(' · '); }

    if (isPinned) {
      item.iconPath = new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.purple'));
    } else {
      item.iconPath = new vscode.ThemeIcon(asset.isFolder ? 'folder' : 'file');
    }

    return item;
  }

  private groupByType(assets: Asset[]): Map<AssetType, Asset[]> {
    const grouped = new Map<AssetType, Asset[]>();
    for (const asset of assets) {
      const existing = grouped.get(asset.type) ?? [];
      existing.push(asset);
      grouped.set(asset.type, existing);
    }
    return grouped;
  }

  getPinRecord(asset: Asset): PinRecord | undefined {
    return this.pinProvider?.findPinRecord(asset);
  }
}
