import * as path from 'path';
import * as vscode from 'vscode';
import { Asset, AssetType, Toolkit } from './types';

/**
 * Tree node types for the sidebar.
 */
type TreeNode = SourceNode | ToolkitNode | AssetTypeNode | AssetNode;

interface SourceNode {
  kind: 'source';
  label: string;
  folderPath: string;
  toolkits: Toolkit[];
}

interface ToolkitNode {
  kind: 'toolkit';
  toolkit: Toolkit;
}

interface AssetTypeNode {
  kind: 'assetType';
  type: AssetType;
  label: string;
  assets: Asset[];
  toolkitEnabled: boolean;
}

interface AssetNode {
  kind: 'asset';
  asset: Asset;
  toolkitEnabled: boolean;
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  [AssetType.Agent]: 'Agents',
  [AssetType.Instruction]: 'Instructions',
  [AssetType.Skill]: 'Skills',
  [AssetType.Prompt]: 'Prompts',
  [AssetType.Plugin]: 'Plugins',
  [AssetType.Hook]: 'Hooks',
  [AssetType.Workflow]: 'Workflows',
  [AssetType.Standard]: 'Standards',
};

const ASSET_TYPE_ICONS: Record<AssetType, string> = {
  [AssetType.Agent]: 'robot',
  [AssetType.Instruction]: 'book',
  [AssetType.Skill]: 'tools',
  [AssetType.Prompt]: 'comment-discussion',
  [AssetType.Plugin]: 'extensions',
  [AssetType.Hook]: 'zap',
  [AssetType.Workflow]: 'play-circle',
  [AssetType.Standard]: 'law',
};

export class ToolkitTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private toolkitsBySource: Map<string, Toolkit[]> = new Map();

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setToolkits(toolkitsBySource: Map<string, Toolkit[]>): void {
    this.toolkitsBySource = toolkitsBySource;
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'source':
        return this.getSourceItem(element);
      case 'toolkit':
        return this.getToolkitItem(element);
      case 'assetType':
        return this.getAssetTypeItem(element);
      case 'asset':
        return this.getAssetItem(element);
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.getRootChildren();
    }

    switch (element.kind) {
      case 'source':
        return element.toolkits.map(toolkit => ({
          kind: 'toolkit' as const,
          toolkit,
        }));

      case 'toolkit': {
        const grouped = this.groupByType(element.toolkit.assets);
        return Array.from(grouped.entries()).map(([type, assets]) => ({
          kind: 'assetType' as const,
          type,
          label: ASSET_TYPE_LABELS[type],
          assets,
          toolkitEnabled: element.toolkit.enabled,
        }));
      }

      case 'assetType':
        return element.assets.map(asset => ({
          kind: 'asset' as const,
          asset,
          toolkitEnabled: element.toolkitEnabled,
        }));

      case 'asset':
        return [];
    }
  }

  private getRootChildren(): TreeNode[] {
    // If only one source, skip the source level and show toolkits directly
    if (this.toolkitsBySource.size === 1) {
      const [, toolkits] = [...this.toolkitsBySource.entries()][0];
      return toolkits.map(toolkit => ({
        kind: 'toolkit' as const,
        toolkit,
      }));
    }

    return [...this.toolkitsBySource.entries()].map(([folderPath, toolkits]) => ({
      kind: 'source' as const,
      label: path.basename(folderPath),
      folderPath,
      toolkits,
    }));
  }

  private getSourceItem(node: SourceNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = new vscode.ThemeIcon('folder-library');
    item.tooltip = node.folderPath;
    item.contextValue = 'source';
    item.description = `${node.toolkits.length} toolkit${node.toolkits.length !== 1 ? 's' : ''}`;
    return item;
  }

  private getToolkitItem(node: ToolkitNode): vscode.TreeItem {
    const tk = node.toolkit;
    const item = new vscode.TreeItem(tk.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon(tk.enabled ? 'check' : 'circle-slash');
    item.tooltip = `${tk.rootPath}\nFormat: ${tk.format}\nAssets: ${tk.assets.length}`;
    item.description = tk.enabled ? 'enabled' : 'disabled';
    item.contextValue = tk.enabled ? 'toolkit-enabled' : 'toolkit-disabled';
    return item;
  }

  private getAssetTypeItem(node: AssetTypeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon(ASSET_TYPE_ICONS[node.type]);
    item.description = `${node.assets.length}`;
    return item;
  }

  private getAssetItem(node: AssetNode): vscode.TreeItem {
    const asset = node.asset;
    const item = new vscode.TreeItem(asset.name, vscode.TreeItemCollapsibleState.None);
    item.tooltip = asset.sourcePath;
    item.contextValue = node.toolkitEnabled ? 'asset-enabled' : 'asset-disabled';

    if (!asset.isFolder) {
      item.command = {
        command: 'aiToolkit.openAsset',
        title: 'Open Asset',
        arguments: [asset],
      };
    }

    item.iconPath = new vscode.ThemeIcon(
      asset.isFolder ? 'folder' : 'file',
    );

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
}
