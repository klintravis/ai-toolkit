import * as vscode from 'vscode';
import { CopilotSettingsManager } from './copilotSettings';
import { ToolkitScanner } from './scanner';
import { ToolkitManager } from './toolkitManager';
import { ToolkitTreeProvider } from './treeProvider';
import { Asset, Toolkit } from './types';

let scanner: ToolkitScanner;
let manager: ToolkitManager;
let copilotSettings: CopilotSettingsManager;
let treeProvider: ToolkitTreeProvider;
let allToolkits: Toolkit[] = [];

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('AI Toolkit');
  scanner = new ToolkitScanner();
  manager = new ToolkitManager(outputChannel);
  copilotSettings = new CopilotSettingsManager(outputChannel);
  treeProvider = new ToolkitTreeProvider();

  const treeView = vscode.window.createTreeView('aiToolkit.toolkits', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register commands
  context.subscriptions.push(
    treeView,
    outputChannel,
    vscode.commands.registerCommand('aiToolkit.refresh', () => refreshToolkits()),
    vscode.commands.registerCommand('aiToolkit.addToolkitPath', () => addToolkitPath()),
    vscode.commands.registerCommand('aiToolkit.removeToolkitPath', (node: { folderPath?: string }) => removeToolkitPath(node)),
    vscode.commands.registerCommand('aiToolkit.enableToolkit', (node: { toolkit?: Toolkit }) => toggleToolkit(node, true)),
    vscode.commands.registerCommand('aiToolkit.disableToolkit', (node: { toolkit?: Toolkit }) => toggleToolkit(node, false)),
    vscode.commands.registerCommand('aiToolkit.enableAsset', (node: { asset?: Asset }) => openAsset(node)),
    vscode.commands.registerCommand('aiToolkit.disableAsset', (node: { asset?: Asset }) => openAsset(node)),
    vscode.commands.registerCommand('aiToolkit.openAsset', (assetOrNode: Asset | { asset?: Asset }) => {
      const asset = 'sourcePath' in assetOrNode ? assetOrNode : assetOrNode.asset;
      if (asset) {
        openAssetFile(asset);
      }
    }),
    vscode.commands.registerCommand('aiToolkit.enableAll', () => toggleAll(true)),
    vscode.commands.registerCommand('aiToolkit.disableAll', () => toggleAll(false)),
  );

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aiToolkit.toolkitPaths')) {
        refreshToolkits();
      }
    }),
  );

  // Initial scan
  refreshToolkits();
}

export function deactivate(): void {
  // Nothing to clean up
}

function shouldConfigureCopilot(): boolean {
  const config = vscode.workspace.getConfiguration('aiToolkit');
  return config.get<boolean>('configureCopilotSettings', true);
}

async function refreshToolkits(): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiToolkit');
  const toolkitPaths = config.get<string[]>('toolkitPaths', []);
  const enabledToolkits = config.get<Record<string, boolean>>('enabledToolkits', {});

  allToolkits = [];
  const toolkitsBySource = new Map<string, Toolkit[]>();

  for (const tkPath of toolkitPaths) {
    const discovered = await scanner.scanPath(tkPath, enabledToolkits);
    if (discovered.length > 0) {
      toolkitsBySource.set(tkPath, discovered);
      allToolkits.push(...discovered);
    }
  }

  treeProvider.setToolkits(toolkitsBySource);

  // Auto-sync if enabled
  const autoSync = config.get<boolean>('autoSync', true);
  if (autoSync) {
    await manager.syncAll(allToolkits);
    if (shouldConfigureCopilot()) {
      await copilotSettings.enableCopilotFeatures(allToolkits);
    }
  }
}

async function addToolkitPath(): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: true,
    openLabel: 'Add Toolkit Folder',
    title: 'Select folder(s) containing AI toolkits',
  });

  if (!uris || uris.length === 0) {
    return;
  }

  const config = vscode.workspace.getConfiguration('aiToolkit');
  const existing = config.get<string[]>('toolkitPaths', []);
  const newPaths = uris.map(uri => uri.fsPath).filter(p => !existing.includes(p));

  if (newPaths.length > 0) {
    await config.update('toolkitPaths', [...existing, ...newPaths], vscode.ConfigurationTarget.Global);
  }
}

async function removeToolkitPath(node: { folderPath?: string }): Promise<void> {
  if (!node.folderPath) {
    return;
  }

  const config = vscode.workspace.getConfiguration('aiToolkit');
  const existing = config.get<string[]>('toolkitPaths', []);
  const updated = existing.filter(p => p !== node.folderPath);
  await config.update('toolkitPaths', updated, vscode.ConfigurationTarget.Global);
}

async function toggleToolkit(node: { toolkit?: Toolkit }, enabled: boolean): Promise<void> {
  const toolkit = node.toolkit;
  if (!toolkit) {
    return;
  }

  toolkit.enabled = enabled;

  const config = vscode.workspace.getConfiguration('aiToolkit');
  const enabledMap = config.get<Record<string, boolean>>('enabledToolkits', {});
  enabledMap[toolkit.id] = enabled;
  await config.update('enabledToolkits', enabledMap, vscode.ConfigurationTarget.Workspace);

  treeProvider.refresh();

  const autoSync = config.get<boolean>('autoSync', true);
  if (autoSync) {
    await manager.syncToolkit(toolkit);
    if (shouldConfigureCopilot()) {
      await copilotSettings.enableCopilotFeatures(allToolkits);
    }
  }
}

async function toggleAll(enabled: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiToolkit');
  const enabledMap = config.get<Record<string, boolean>>('enabledToolkits', {});

  for (const toolkit of allToolkits) {
    toolkit.enabled = enabled;
    enabledMap[toolkit.id] = enabled;
  }

  await config.update('enabledToolkits', enabledMap, vscode.ConfigurationTarget.Workspace);
  treeProvider.refresh();

  const autoSync = config.get<boolean>('autoSync', true);
  if (autoSync) {
    await manager.syncAll(allToolkits);
    if (shouldConfigureCopilot()) {
      if (enabled) {
        await copilotSettings.enableCopilotFeatures(allToolkits);
      } else {
        await copilotSettings.cleanCopilotInstructions();
      }
    }
  }
}

function openAsset(node: { asset?: Asset }): void {
  if (node.asset) {
    openAssetFile(node.asset);
  }
}

function openAssetFile(asset: Asset): void {
  const uri = vscode.Uri.file(asset.sourcePath);
  if (asset.isFolder) {
    vscode.commands.executeCommand('revealFileInOS', uri);
  } else {
    vscode.window.showTextDocument(uri, { preview: true });
  }
}
