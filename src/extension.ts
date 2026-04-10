import * as path from 'path';
import * as vscode from 'vscode';
import { ClonedToolkitsStore } from './clonedToolkitsStore';
import { DashboardHost, DashboardMessage, DashboardPanel, DashboardState } from './dashboard';
import { CopilotSettingsManager } from './copilotSettings';
import { ClaudeSettingsManager } from './claudeSettings';
import { GitError, GitToolkitManager, deriveRepoName, isValidRemoteUrl, normalizeRemoteUrl } from './git';
import { expandHomePath, normalizeForComparison, pathExists, toToolkitId } from './pathUtils';
import { PinManager, PinRecordStore, isInsidePinsDir } from './picks';
import { ToolkitScanner } from './scanner';
import { ToolkitTreeProvider } from './treeProvider';
import { Asset, ClonedToolkitRecord, DEFAULT_PIN_GROUP, PinRecord, Toolkit, ToolkitUpdateStatus } from './types';
import { UpdateChecker } from './updateChecker';

let scanner: ToolkitScanner;
let copilotSettings: CopilotSettingsManager;
let claudeSettings: ClaudeSettingsManager;
let treeProvider: ToolkitTreeProvider;
let gitManager: GitToolkitManager;
let clonedStore: ClonedToolkitsStore;
let updateChecker: UpdateChecker;
let pinManager: PinManager;
let statusBarItem: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext;
let allToolkits: Toolkit[] = [];
let activeRefresh: Promise<void> | undefined;
let outputChannel: vscode.OutputChannel;
let gitAvailable = true;
const updateStatusCache = new Map<string, ToolkitUpdateStatus>();
let updateCheckInterval: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('AI Toolkit');
  scanner = new ToolkitScanner();
  copilotSettings = new CopilotSettingsManager(outputChannel);
  claudeSettings = new ClaudeSettingsManager(
    context,
    outputChannel,
    () => vscode.workspace.getConfiguration('aiToolkit').get<string>('claudeSettingsPath', '~/.claude/settings.json'),
    () => vscode.workspace.getConfiguration('aiToolkit').get<string>('claudePluginsPath', '~/.ai-toolkits/claude-plugins'),
  );
  treeProvider = new ToolkitTreeProvider();
  gitManager = new GitToolkitManager(outputChannel);
  clonedStore = new ClonedToolkitsStore(context);
  updateChecker = new UpdateChecker(gitManager, outputChannel);
  pinManager = new PinManager(
    new PinRecordStore(context),
    outputChannel,
    () => vscode.workspace.getConfiguration('aiToolkit').get<string>('picksDirectory', '~/.ai-toolkits/my-picks'),
  );
  treeProvider.setPinProvider(pinManager);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'aiToolkit.openDashboard';
  statusBarItem.tooltip = 'AI Toolkit: click to open the dashboard';
  statusBarItem.show();

  const treeView = vscode.window.createTreeView('aiToolkit.toolkits', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    treeView,
    statusBarItem,
    outputChannel,
    treeProvider,
    vscode.commands.registerCommand('aiToolkit.refresh', () => refreshToolkits()),
    vscode.commands.registerCommand('aiToolkit.addToolkitPath', () => addToolkitPath()),
    vscode.commands.registerCommand('aiToolkit.removeToolkitPath', (node: { folderPath?: string; toolkit?: Toolkit }) => removeToolkitPath(node)),
    vscode.commands.registerCommand('aiToolkit.deleteGroupFromTree', (node: { toolkit?: Toolkit }) => deleteGroupFromTree(node)),
    vscode.commands.registerCommand('aiToolkit.enableToolkit', (node: { toolkit?: Toolkit }) => toggleToolkit(node, true)),
    vscode.commands.registerCommand('aiToolkit.disableToolkit', (node: { toolkit?: Toolkit }) => toggleToolkit(node, false)),
    vscode.commands.registerCommand('aiToolkit.openAsset', (assetOrNode: Asset | { asset?: Asset }) => {
      const asset = 'sourcePath' in assetOrNode ? assetOrNode : assetOrNode.asset;
      if (asset) {
        openAssetFile(asset);
      }
    }),
    vscode.commands.registerCommand('aiToolkit.enableAll', () => toggleAll(true)),
    vscode.commands.registerCommand('aiToolkit.disableAll', () => toggleAll(false)),
    vscode.commands.registerCommand('aiToolkit.addToWorkspace', (node: { toolkit?: Toolkit }) => {
      if (node.toolkit) { copilotSettings.addAsWorkspaceFolder(node.toolkit); }
    }),
    vscode.commands.registerCommand('aiToolkit.removeFromWorkspace', (node: { toolkit?: Toolkit }) => {
      if (node.toolkit) { copilotSettings.removeWorkspaceFolder(node.toolkit); }
    }),
    vscode.commands.registerCommand('aiToolkit.cloneToolkit', () => cloneToolkit()),
    vscode.commands.registerCommand('aiToolkit.checkForUpdates', () => checkForUpdates(true)),
    vscode.commands.registerCommand('aiToolkit.updateToolkit', (node: { toolkit?: Toolkit }) => updateToolkitCommand(node)),
    vscode.commands.registerCommand('aiToolkit.updateAllToolkits', () => updateAllToolkits()),
    vscode.commands.registerCommand('aiToolkit.pinAsset', (node: { asset?: Asset; toolkit?: Toolkit }) => pinAssetCommand(node)),
    vscode.commands.registerCommand('aiToolkit.unpinAsset', (node: { asset?: Asset }) => unpinAssetCommand(node)),
    vscode.commands.registerCommand('aiToolkit.openPicksFolder', () => openPinsFolder()),
    vscode.commands.registerCommand('aiToolkit.createGroup', () => createGroupCommand()),
    vscode.commands.registerCommand('aiToolkit.deleteGroup', () => deleteGroupCommand()),
    vscode.commands.registerCommand('aiToolkit.renameGroup', () => renameGroupCommand()),
    vscode.commands.registerCommand('aiToolkit.moveAssetToGroup', (node: { asset?: Asset }) => moveAssetCommand(node)),
    vscode.commands.registerCommand('aiToolkit.openDashboard', () => openDashboard()),
    vscode.commands.registerCommand('aiToolkit.openPickSource', (record: PinRecord) => {
      if (record) { openAssetFile(record); }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aiToolkit.toolkitPaths')) {
        refreshToolkits().catch(err =>
          outputChannel.appendLine(`Refresh after config change failed: ${err}`)
        );
      }
      if (e.affectsConfiguration('aiToolkit.updateCheckIntervalMinutes')) {
        schedulePeriodicCheck();
      }
    }),
    { dispose: () => { if (updateCheckInterval) { clearInterval(updateCheckInterval); } } },
  );

  // Clean up pre-group layout, then do a single initial refresh.
  (async () => {
    try {
      await pinManager.cleanupLegacyAssetTypeFolders();
      const n = await pinManager.migrateLegacyLayout();
      if (n > 0) { outputChannel.appendLine(`[pins] migrated ${n} legacy pick(s) to "${DEFAULT_PIN_GROUP}" group`); }
    } catch (err) {
      outputChannel.appendLine(`Legacy migration failed: ${err}`);
    }
    try {
      await refreshToolkits();
      // After initial refresh, optionally schedule startup update check.
      const cfg = vscode.workspace.getConfiguration('aiToolkit');
      if (cfg.get<boolean>('checkForUpdatesOnStartup', true)) {
        setTimeout(() => {
          checkForUpdates(false).catch(err =>
            outputChannel.appendLine(`Startup update check failed: ${err}`)
          );
        }, 10_000);
      }
      schedulePeriodicCheck();
    } catch (err) {
      outputChannel.appendLine(`Initial refresh failed: ${err}`);
    }
  })();
}

export function deactivate(): void {
  if (updateCheckInterval) { clearInterval(updateCheckInterval); }
}

function isCopilotAutoConfigEnabled(): boolean {
  return vscode.workspace.getConfiguration('aiToolkit').get<boolean>('configureCopilotSettings', true);
}

function getErrorMessage(err: unknown): string {
  return err instanceof GitError ? err.message : String(err);
}

async function showErrorWithLog(message: string): Promise<void> {
  const choice = await vscode.window.showErrorMessage(message, 'Show Log');
  if (choice === 'Show Log') { outputChannel.show(); }
}

function isValidGroupName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) { return 'Name required'; }
  if (!/^[\w.-]+$/.test(trimmed)) { return 'Use letters, numbers, dots, dashes, underscores'; }
  return null;
}

/**
 * Coalescing wrapper: if a refresh is already running, callers await the
 * same promise instead of starting a concurrent scan.
 */
async function refreshToolkits(): Promise<void> {
  if (activeRefresh) {
    return activeRefresh;
  }
  activeRefresh = scanAndApplyToolkits();
  try {
    await activeRefresh;
  } finally {
    activeRefresh = undefined;
  }
}

async function warnIfOldFormatToolkits(toolkitPaths: string[], discoveredCount: number): Promise<void> {
  if (discoveredCount > 0) return;
  const OLD_FORMAT_INDICATORS = ['agents', 'instructions', 'skills', 'prompts'];
  for (const rawPath of toolkitPaths) {
    const tkPath = expandHomePath(rawPath);
    for (const folder of OLD_FORMAT_INDICATORS) {
      if (await pathExists(path.join(tkPath, folder))) {
        void vscode.window.showWarningMessage(
          `AI Toolkit: "${path.basename(rawPath)}" uses the old format. Migrate to copilot/ and claude/ subfolders to use the new DualPlatform format.`,
          'Learn More',
        );
        return;
      }
    }
    const githubDir = path.join(tkPath, '.github');
    for (const folder of OLD_FORMAT_INDICATORS) {
      if (await pathExists(path.join(githubDir, folder))) {
        void vscode.window.showWarningMessage(
          `AI Toolkit: "${path.basename(rawPath)}" uses the old .github/ format. Migrate to the new DualPlatform layout.`,
          'Learn More',
        );
        return;
      }
    }
  }
}

async function scanAndApplyToolkits(): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiToolkit');
  const toolkitPaths = config.get<string[]>('toolkitPaths', []);
  const enabledToolkits = config.get<Record<string, boolean>>('enabledToolkits', {});

  const toolkitsBySource = new Map<string, Toolkit[]>();
  const discovered: Toolkit[] = [];

  const results = await Promise.allSettled(
    toolkitPaths.map(tkPath => scanner.scanPath(tkPath, enabledToolkits))
  );

  for (let i = 0; i < toolkitPaths.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value.length > 0) {
      toolkitsBySource.set(toolkitPaths[i], result.value);
      discovered.push(...result.value);
    } else if (result.status === 'rejected') {
      outputChannel.appendLine(`Failed to scan ${toolkitPaths[i]}: ${result.reason}`);
    }
  }

  const pinsDir = pinManager.getPinsDir();
  for (const toolkit of discovered) {
    toolkit.isCloned = clonedStore.isCloned(toolkit.rootPath);
    toolkit.isPinGroup = isInsidePinsDir(toolkit.rootPath, pinsDir) &&
      normalizeForComparison(toolkit.rootPath) !== normalizeForComparison(pinsDir);
    const status = updateStatusCache.get(normalizeForComparison(toolkit.rootPath));
    if (status) { toolkit.update = status; }
  }

  allToolkits = discovered;
  await warnIfOldFormatToolkits(toolkitPaths, discovered.length);
  treeProvider.setToolkits(toolkitsBySource);
  updateStatusBarAndTree();

  if (isCopilotAutoConfigEnabled()) {
    await copilotSettings.applyToolkits(allToolkits);
    await claudeSettings.applyToolkits(allToolkits);
  }
}

/** Update the unified tree (summary + pinned sections) and status bar. */
function updateStatusBarAndTree(): void {
  const picks = pinManager.listPinRecords();
  const activeToolkits = allToolkits.filter(t => t.enabled).length;
  const updatesAvailable = allToolkits.filter(t => t.update?.updateAvailable).length;
  treeProvider.setPinRecords(picks);
  treeProvider.setSummary({ activeToolkits, updatesAvailable });
  const parts = [`$(check) ${activeToolkits} active`, `$(pinned) ${picks.length} pinned`];
  if (updatesAvailable > 0) { parts.push(`$(sync) ${updatesAvailable}`); }
  statusBarItem.text = parts.join('  ');
  // Refresh dashboard if open.
  DashboardPanel.current?.refresh();
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
  const existingNormalized = new Set(existing.map(p => normalizeForComparison(p)));
  const newPaths = uris
    .map(uri => uri.fsPath)
    .filter(p => !existingNormalized.has(normalizeForComparison(p)));

  if (newPaths.length > 0) {
    await config.update('toolkitPaths', [...existing, ...newPaths], vscode.ConfigurationTarget.Global);
  }
}

async function removeToolkitPath(node: { folderPath?: string; toolkit?: Toolkit }): Promise<void> {
  // Accept either a SourceNode-style {folderPath} or a ToolkitNode {toolkit}.
  const folderPath = node.folderPath ?? node.toolkit?.rootPath;
  if (!folderPath) { return; }

  // Pick groups are never removed via this path — they're deleted via deleteGroup.
  if (node.toolkit?.isPinGroup) {
    await deleteGroupFromTree({ toolkit: node.toolkit });
    return;
  }

  const config = vscode.workspace.getConfiguration('aiToolkit');
  const existing = config.get<string[]>('toolkitPaths', []);
  const targetNormalized = normalizeForComparison(folderPath);
  const updated = existing.filter(p => normalizeForComparison(p) !== targetNormalized);
  await config.update('toolkitPaths', updated, vscode.ConfigurationTarget.Global);

  // Also purge the cloned record if this was a cloned toolkit.
  if (clonedStore.isCloned(folderPath)) {
    await clonedStore.remove(folderPath);
  }
  // Clear any in-memory update status for this root.
  updateStatusCache.delete(normalizeForComparison(folderPath));

  // Unpin any assets that originated from this toolkit.
  const removedToolkit = allToolkits.find(t => normalizeForComparison(t.rootPath) === normalizeForComparison(folderPath));
  if (removedToolkit) {
    await pinManager.unpinAllFromToolkit(removedToolkit.id);
  }
}

async function toggleToolkit(node: { toolkit?: Toolkit }, enabled: boolean): Promise<void> {
  const toolkit = node.toolkit;
  if (!toolkit) {
    return;
  }

  toolkit.enabled = enabled;

  const config = vscode.workspace.getConfiguration('aiToolkit');
  const enabledMap = { ...config.get<Record<string, boolean>>('enabledToolkits', {}) };
  enabledMap[toolkit.id] = enabled;
  await config.update('enabledToolkits', enabledMap, vscode.ConfigurationTarget.Global);

  treeProvider.refresh();
  updateStatusBarAndTree();

  if (isCopilotAutoConfigEnabled()) {
    await copilotSettings.applyToolkits(allToolkits);
    await claudeSettings.applyToolkits(allToolkits);
  }
}

async function toggleAll(enabled: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiToolkit');
  const enabledMap = { ...config.get<Record<string, boolean>>('enabledToolkits', {}) };

  for (const toolkit of allToolkits) {
    toolkit.enabled = enabled;
    enabledMap[toolkit.id] = enabled;
  }

  await config.update('enabledToolkits', enabledMap, vscode.ConfigurationTarget.Global);
  treeProvider.refresh();
  updateStatusBarAndTree();

  if (isCopilotAutoConfigEnabled()) {
    await copilotSettings.applyToolkits(allToolkits);
    await claudeSettings.applyToolkits(allToolkits);
  }
}

function openAssetFile(item: { sourcePath: string; isFolder: boolean }): void {
  const uri = vscode.Uri.file(item.sourcePath);
  if (item.isFolder) {
    vscode.commands.executeCommand('revealFileInOS', uri);
  } else {
    vscode.window.showTextDocument(uri, { preview: true });
  }
}

async function ensurePinsDirRegistered(): Promise<boolean> {
  const picksDir = pinManager.getPinsDir();
  const config = vscode.workspace.getConfiguration('aiToolkit');
  const existing = config.get<string[]>('toolkitPaths', []);
  const alreadyRegistered = existing.some(p => normalizeForComparison(p) === normalizeForComparison(picksDir));
  if (!alreadyRegistered) {
    await config.update('toolkitPaths', [...existing, picksDir], vscode.ConfigurationTarget.Global);
    return true;
  }
  return false;
}

async function removeEnabledFlag(toolkitId: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('aiToolkit');
  const enabledMap = { ...cfg.get<Record<string, boolean>>('enabledToolkits', {}) };
  if (toolkitId in enabledMap) {
    delete enabledMap[toolkitId];
    await cfg.update('enabledToolkits', enabledMap, vscode.ConfigurationTarget.Global);
  } else {
    await refreshToolkits();
  }
}

async function transferEnabledFlag(oldGroupName: string, newGroupName: string): Promise<void> {
  const oldId = toToolkitId(pinManager.getGroupDir(oldGroupName));
  const newId = toToolkitId(pinManager.getGroupDir(newGroupName));
  const cfg = vscode.workspace.getConfiguration('aiToolkit');
  const enabledMap = { ...cfg.get<Record<string, boolean>>('enabledToolkits', {}) };
  if (enabledMap[oldId] !== undefined) {
    enabledMap[newId] = enabledMap[oldId];
    delete enabledMap[oldId];
    await cfg.update('enabledToolkits', enabledMap, vscode.ConfigurationTarget.Global);
  } else {
    await refreshToolkits();
  }
}

async function confirmAndDeleteGroup(groupName: string): Promise<number> {
  const confirm = await vscode.window.showWarningMessage(
    `Delete group "${groupName}" and all its picks?`, { modal: true }, 'Delete'
  );
  if (confirm !== 'Delete') { return -1; }
  const count = await pinManager.deleteGroup(groupName);
  await removeEnabledFlag(toToolkitId(pinManager.getGroupDir(groupName)));
  vscode.window.showInformationMessage(`Deleted group "${groupName}" (${count} pick(s) removed).`);
  return count;
}

// --- Clone & Update commands ---

async function cloneToolkit(): Promise<void> {
  const version = await gitManager.checkGitAvailable();
  if (!version) {
    const pick = await vscode.window.showErrorMessage(
      'git is not installed or not on PATH. Install git to clone toolkits.',
      'Learn more'
    );
    if (pick === 'Learn more') {
      vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
    }
    return;
  }

  const urlInput = await vscode.window.showInputBox({
    prompt: 'GitHub repository URL (or owner/repo shorthand)',
    placeHolder: 'github/awesome-copilot or https://github.com/user/repo.git',
    validateInput: v => (isValidRemoteUrl(v) ? null : 'Enter a valid git URL or owner/repo shorthand'),
  });
  if (!urlInput) { return; }
  const remoteUrl = normalizeRemoteUrl(urlInput);

  const suggestedName = deriveRepoName(remoteUrl);
  const folderName = await vscode.window.showInputBox({
    prompt: 'Folder name for the clone',
    value: suggestedName,
    validateInput: v => {
      if (!v || !/^[\w.-]+$/.test(v)) { return 'Use letters, numbers, dots, dashes, underscores'; }
      if (/^\.+$/.test(v)) { return 'Invalid folder name'; }
      return null;
    },
  });
  if (!folderName) { return; }

  const config = vscode.workspace.getConfiguration('aiToolkit');
  const cloneParentRaw = config.get<string>('cloneDirectory', '~/.ai-toolkits');
  const cloneParent = expandHomePath(cloneParentRaw);

  const controller = new AbortController();
  try {
    const cloneResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Cloning ${remoteUrl}…`,
        cancellable: true,
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        return gitManager.clone({
          remoteUrl,
          targetParentDir: cloneParent,
          targetName: folderName,
          signal: controller.signal,
        });
      }
    );

    const record: ClonedToolkitRecord = {
      rootPath: cloneResult.rootPath.replace(/\\/g, '/'),
      remoteUrl,
      branch: cloneResult.branch,
      lastKnownSha: cloneResult.sha,
      clonedAt: new Date().toISOString(),
    };
    await clonedStore.add(record);

    // Add to toolkitPaths if not already present.
    const existing = config.get<string[]>('toolkitPaths', []);
    const existingNormalized = new Set(existing.map(p => normalizeForComparison(p)));
    if (!existingNormalized.has(normalizeForComparison(cloneResult.rootPath))) {
      await config.update('toolkitPaths', [...existing, cloneResult.rootPath], vscode.ConfigurationTarget.Global);
    } else {
      // Path already registered — trigger refresh explicitly.
      await refreshToolkits();
    }

    const pick = await vscode.window.showInformationMessage(
      `Cloned ${folderName} to ${cloneResult.rootPath}`,
      'Reveal in File Explorer'
    );
    if (pick === 'Reveal in File Explorer') {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(cloneResult.rootPath));
    }
  } catch (err) {
    if (controller.signal.aborted) {
      outputChannel.appendLine('Clone cancelled.');
      return;
    }
    await showErrorWithLog(`Clone failed: ${getErrorMessage(err)}`);
  }
}

async function checkForUpdates(showStatus: boolean): Promise<void> {
  const clonedRecords = clonedStore.list();
  if (clonedRecords.length === 0) {
    if (showStatus) {
      vscode.window.showInformationMessage('No cloned toolkits to check.');
    }
    return;
  }

  const validRoots: string[] = [];
  for (const rec of clonedRecords) {
    if (await pathExists(rec.rootPath)) {
      validRoots.push(rec.rootPath);
    } else {
      outputChannel.appendLine(`Skipping missing clone: ${rec.rootPath}`);
    }
  }

  if (validRoots.length === 0) {
    if (showStatus) {
      vscode.window.showWarningMessage('All cloned toolkits are missing from disk.');
    }
    return;
  }

  const results = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'Checking toolkit updates…',
    },
    () => updateChecker.checkAll(validRoots)
  );

  // Merge results into in-memory status map and annotate toolkits.
  let updatableCount = 0;
  for (const [rootPath, status] of results.entries()) {
    updateStatusCache.set(normalizeForComparison(rootPath), status);
    if (status.updateAvailable) { updatableCount++; }
  }
  for (const toolkit of allToolkits) {
    const status = updateStatusCache.get(normalizeForComparison(toolkit.rootPath));
    if (status) { toolkit.update = status; }
  }
  treeProvider.refresh();

  if (showStatus) {
    if (updatableCount > 0) {
      vscode.window.showInformationMessage(`${updatableCount} toolkit update(s) available`);
    } else {
      vscode.window.showInformationMessage('All toolkits up to date');
    }
  }
}

async function updateToolkitCommand(node: { toolkit?: Toolkit }): Promise<void> {
  const toolkit = node.toolkit;
  if (!toolkit) { return; }
  if (!toolkit.isCloned) {
    vscode.window.showWarningMessage(`${toolkit.name} was not cloned by AI Toolkit — update skipped.`);
    return;
  }

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Updating ${toolkit.name}…`,
      },
      () => gitManager.pull(toolkit.rootPath)
    );
    await clonedStore.updateSha(toolkit.rootPath, result.sha);
    updateStatusCache.delete(normalizeForComparison(toolkit.rootPath));
    toolkit.update = undefined;

    // Refresh copy-type picks so their content reflects the updated source.
    if (result.updated) { await pinManager.resync(); }

    await refreshToolkits();
    vscode.window.showInformationMessage(
      result.updated ? `Updated ${toolkit.name} to ${result.sha}` : `${toolkit.name} already up to date`
    );
  } catch (err) {
    if (err instanceof GitError && err.code === 'PULL_NOT_FAST_FORWARD') {
      const pick = await vscode.window.showErrorMessage(
        `${toolkit.name}: cannot fast-forward — local branch has diverged.`,
        'Open in Terminal', 'Show Log'
      );
      if (pick === 'Open in Terminal') {
        const terminal = vscode.window.createTerminal({ cwd: toolkit.rootPath, name: toolkit.name });
        terminal.show();
      } else if (pick === 'Show Log') {
        outputChannel.show();
      }
    } else {
      await showErrorWithLog(`Update failed: ${getErrorMessage(err)}`);
    }
  }
}

async function updateAllToolkits(): Promise<void> {
  const updatable = allToolkits.filter(t => t.isCloned && t.update?.updateAvailable);
  if (updatable.length === 0) {
    vscode.window.showInformationMessage('No cloned toolkits need updating. Run "Check for Toolkit Updates" first.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Updating ${updatable.length} toolkit(s)…`,
    },
    async (progress) => {
      for (const toolkit of updatable) {
        progress.report({ message: toolkit.name });
        try {
          const result = await gitManager.pull(toolkit.rootPath);
          await clonedStore.updateSha(toolkit.rootPath, result.sha);
          updateStatusCache.delete(normalizeForComparison(toolkit.rootPath));
          toolkit.update = undefined;
        } catch (err) {
          outputChannel.appendLine(`Failed to update ${toolkit.name}: ${getErrorMessage(err)}`);
        }
      }
    }
  );
  await pinManager.resync();
  await refreshToolkits();
  vscode.window.showInformationMessage('Update all complete.');
}

// --- Pin / Unpin commands ---

async function pinAssetCommand(node: { asset?: Asset; toolkit?: Toolkit }): Promise<void> {
  const asset = node.asset;
  if (!asset) { return; }

  // Find the owning toolkit. Tree passes it on the node but fall back to a lookup.
  let toolkit = node.toolkit;
  if (!toolkit) {
    toolkit = allToolkits.find(t => asset.id.startsWith(`${t.id}::`));
  }
  if (!toolkit) {
    vscode.window.showErrorMessage('Could not determine the toolkit for this asset.');
    return;
  }
  if (pinManager.isPinsToolkit(toolkit)) {
    vscode.window.showInformationMessage('This asset is already in your picks.');
    return;
  }

  // Let the user pick a group (existing or new).
  const group = await promptForGroup();
  if (!group) { return; }

  try {
    await pinManager.ensureStructure(group);
    const record = await pinManager.pin(asset, toolkit, group);
    outputChannel.appendLine(`[pins] pin complete: ${record.targetPath} (${record.linkType})`);

    // Auto-enable the specific group's toolkit so Copilot picks it up immediately.
    const groupToolkitId = toToolkitId(pinManager.getGroupDir(group));
    const config = vscode.workspace.getConfiguration('aiToolkit');
    const enabledMap = { ...config.get<Record<string, boolean>>('enabledToolkits', {}) };
    const wasEnabled = enabledMap[groupToolkitId] === true;
    if (!wasEnabled) {
      enabledMap[groupToolkitId] = true;
      await config.update('enabledToolkits', enabledMap, vscode.ConfigurationTarget.Global);
    }

    const wasAdded = await ensurePinsDirRegistered();
    if (wasAdded) {
      vscode.window.showInformationMessage(
        `Pinned to "${group}" group. Group is now enabled for Copilot discovery.`
      );
    } else if (!wasEnabled) {
      await refreshToolkits();
      vscode.window.showInformationMessage(`Pinned to "${group}" group (enabled).`);
    } else {
      await refreshToolkits();
    }
  } catch (err) {
    outputChannel.appendLine(`[pins] pin failed: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    await showErrorWithLog(`Pin failed: ${getErrorMessage(err)}`);
  }
}

/**
 * Ask the user which group to pin into. Shows existing groups plus a
 * "New group…" option. Returns undefined if the user cancels.
 */
async function promptForGroup(preselected?: string): Promise<string | undefined> {
  const existing = await pinManager.listGroups();
  const items: vscode.QuickPickItem[] = [
    ...existing.map(g => ({ label: g, description: `${pinManager.listPinsInGroup(g).length} pick(s)` })),
    { label: '$(add) New group…', description: 'Create a new group' },
  ];
  if (existing.length === 0) {
    items.unshift({ label: DEFAULT_PIN_GROUP, description: 'default group' });
  }

  const chosen = await vscode.window.showQuickPick(items, {
    title: 'Pin to group',
    placeHolder: preselected ?? 'Choose or create a group',
  });
  if (!chosen) { return undefined; }
  if (chosen.label.startsWith('$(add)')) {
    const name = await vscode.window.showInputBox({
      prompt: 'New group name',
      placeHolder: 'e.g. web-dev, python, devops',
      validateInput: isValidGroupName,
    });
    return name?.trim();
  }
  return chosen.label;
}

async function unpinAssetCommand(node: { asset?: Asset }): Promise<void> {
  const asset = node.asset;
  if (!asset) { return; }
  const record = pinManager.findPinRecord(asset);
  if (!record) {
    vscode.window.showInformationMessage('This asset is not pinned.');
    return;
  }
  try {
    await pinManager.unpin(record.assetId);
    await refreshToolkits();
  } catch (err) {
    await showErrorWithLog(`Unpin failed: ${getErrorMessage(err)}`);
  }
}

async function openPinsFolder(): Promise<void> {
  await pinManager.ensureStructure();
  const picksDir = pinManager.getPinsDir();
  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(picksDir));
}

async function createGroupCommand(): Promise<void> {
  const currentGroups = await pinManager.listGroups();
  const name = await vscode.window.showInputBox({
    prompt: 'New group name',
    placeHolder: 'e.g. web-dev, python, devops',
    validateInput: v => {
      const err = isValidGroupName(v);
      if (err) { return err; }
      if (currentGroups.includes(v.trim().toLowerCase())) { return 'Group already exists'; }
      return null;
    },
  });
  if (!name) { return; }
  await pinManager.ensureStructure(name);
  if (!(await ensurePinsDirRegistered())) {
    await refreshToolkits();
  }
  vscode.window.showInformationMessage(`Created group "${name}".`);
}

async function deleteGroupCommand(): Promise<void> {
  const groups = await pinManager.listGroups();
  if (groups.length === 0) {
    vscode.window.showInformationMessage('No groups to delete.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    groups.map(g => ({ label: g, description: `${pinManager.listPinsInGroup(g).length} pick(s)` })),
    { title: 'Delete group', placeHolder: 'Select a group to delete' }
  );
  if (!pick) { return; }
  await confirmAndDeleteGroup(pick.label);
}

async function renameGroupCommand(): Promise<void> {
  const groups = await pinManager.listGroups();
  if (groups.length === 0) {
    vscode.window.showInformationMessage('No groups to rename.');
    return;
  }
  const pick = await vscode.window.showQuickPick(groups, { title: 'Rename group', placeHolder: 'Select group' });
  if (!pick) { return; }
  await promptRenameGroup(pick, groups);
}

async function deleteGroupFromTree(node: { toolkit?: Toolkit }): Promise<void> {
  const toolkit = node.toolkit;
  if (!toolkit || !toolkit.isPinGroup) { return; }
  await confirmAndDeleteGroup(toolkit.name);
}

/** Shared rename logic: prompt for new name, rename on disk, transfer enabled flag. */
async function promptRenameGroup(oldName: string, existingGroups: string[]): Promise<void> {
  const newName = await vscode.window.showInputBox({
    prompt: `Rename "${oldName}" to`,
    value: oldName,
    validateInput: v => {
      const err = isValidGroupName(v);
      if (err) { return err; }
      const t = v.trim();
      if (t === oldName) { return null; }
      if (existingGroups.includes(t.toLowerCase())) { return 'Group already exists'; }
      return null;
    },
  });
  if (!newName || newName === oldName) { return; }
  try {
    await pinManager.renameGroup(oldName, newName);
    await transferEnabledFlag(oldName, newName);
    vscode.window.showInformationMessage(`Renamed "${oldName}" → "${newName}".`);
  } catch (err) {
    vscode.window.showErrorMessage(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function moveAssetCommand(node: { asset?: Asset }): Promise<void> {
  const asset = node.asset;
  if (!asset) { return; }
  const record = pinManager.findPinRecord(asset);
  if (!record) {
    vscode.window.showInformationMessage('Not a pinned asset.');
    return;
  }
  const target = await promptForGroup(record.groupName);
  if (!target || target === record.groupName) { return; }
  await pinManager.moveToGroup(record.assetId, target);
  await refreshToolkits();
  vscode.window.showInformationMessage(`Moved "${record.assetName}" to "${target}".`);
}

// --- Dashboard ---

function openDashboard(): void {
  const host: DashboardHost = {
    getState: () => buildDashboardState(),
    handle: async (msg: DashboardMessage) => handleDashboardMessage(msg),
  };
  DashboardPanel.show(host, extensionContext.extensionUri);
}

async function buildDashboardState(): Promise<DashboardState> {
  const cfg = vscode.workspace.getConfiguration('aiToolkit');
  return {
    toolkits: allToolkits,
    pins: pinManager.listPinRecords(),
    groups: await pinManager.listGroups(),
    pinsDir: pinManager.getPinsDir(),
    cloneDir: expandHomePath(cfg.get<string>('cloneDirectory', '~/.ai-toolkits')),
    gitAvailable: gitAvailable,
  };
}

async function handleDashboardMessage(msg: DashboardMessage): Promise<void> {
  switch (msg.type) {
    case 'ready':
      // git availability probe (cached)
      gitManager.checkGitAvailable().then(v => { gitAvailable = !!v; });
      return;
    case 'toggleToolkit': {
      const toolkit = allToolkits.find(t => t.id === msg.toolkitId);
      if (toolkit) { await toggleToolkit({ toolkit }, msg.enabled); }
      return;
    }
    case 'updateToolkit': {
      const toolkit = allToolkits.find(t => normalizeForComparison(t.rootPath) === normalizeForComparison(msg.rootPath));
      if (toolkit) { await updateToolkitCommand({ toolkit }); }
      return;
    }
    case 'removeToolkit': {
      const toolkit = allToolkits.find(t => normalizeForComparison(t.rootPath) === normalizeForComparison(msg.rootPath));
      if (toolkit) { await removeToolkitPath({ folderPath: toolkit.rootPath }); }
      return;
    }
    case 'unpinAsset':
      await pinManager.unpin(msg.assetId);
      await refreshToolkits();
      return;
    case 'moveAsset': {
      const record = pinManager.listPinRecords().find(r => r.assetId === msg.assetId);
      if (!record) { return; }
      const target = await promptForGroup(record.groupName);
      if (!target || target === record.groupName) { return; }
      await pinManager.moveToGroup(msg.assetId, target);
      await refreshToolkits();
      return;
    }
    case 'createGroup':
      await createGroupCommand();
      return;
    case 'deleteGroup':
      if (msg.groupName) { await confirmAndDeleteGroup(msg.groupName); }
      else { await deleteGroupCommand(); }
      return;
    case 'renameGroup':
      if (msg.groupName) {
        const groups = await pinManager.listGroups();
        await promptRenameGroup(msg.groupName, groups);
      } else { await renameGroupCommand(); }
      return;
    case 'openSource': {
      const pinsDir = pinManager.getPinsDir();
      const knownRoots = allToolkits.map(t => t.rootPath);
      knownRoots.push(pinsDir);
      const sourcePath = msg.sourcePath;
      const isUnderKnownRoot = knownRoots.some(root => {
        const normSource = normalizeForComparison(sourcePath);
        const normRoot = normalizeForComparison(root);
        return normSource === normRoot || normSource.startsWith(normRoot + '/');
      });
      if (isUnderKnownRoot) {
        openAssetFile({ sourcePath, isFolder: msg.isFolder });
      } else {
        outputChannel.appendLine(`[security] blocked openSource for path outside known roots: ${sourcePath}`);
      }
      return;
    }
    case 'cloneToolkit':
      await cloneToolkit();
      return;
    case 'addToolkitPath':
      await addToolkitPath();
      return;
    case 'checkForUpdates':
      await checkForUpdates(true);
      return;
    case 'updateAllToolkits':
      await updateAllToolkits();
      return;
    case 'openPinsFolder':
      await openPinsFolder();
      return;
    case 'openSettings':
      vscode.commands.executeCommand('workbench.action.openSettings', 'aiToolkit');
      return;
    case 'refresh':
      await refreshToolkits();
      return;
  }
}


function schedulePeriodicCheck(): void {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = undefined;
  }
  const raw = vscode.workspace.getConfiguration('aiToolkit').get<number>('updateCheckIntervalMinutes', 0);
  const minutes = raw > 0 ? Math.max(raw, 5) : 0;
  if (minutes > 0) {
    updateCheckInterval = setInterval(() => {
      checkForUpdates(false).catch(err =>
        outputChannel.appendLine(`Periodic update check failed: ${err}`)
      );
    }, minutes * 60 * 1000);
  }
}
