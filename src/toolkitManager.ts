import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Asset, Toolkit, TARGET_SUBDIRS } from './types';

/**
 * Manages syncing enabled toolkit assets into the active workspace.
 */
export class ToolkitManager {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Sync all enabled toolkits' assets into the workspace target directory.
   */
  async syncAll(toolkits: Toolkit[]): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('AI Toolkit: No workspace folder open. Cannot sync assets.');
      return;
    }

    const config = vscode.workspace.getConfiguration('aiToolkit');
    const targetDir = config.get<string>('targetDirectory', '.github');
    const syncMethod = config.get<string>('syncMethod', 'symlink');
    const targetRoot = path.join(workspaceRoot, targetDir);

    // Clean up previously synced assets (those managed by us)
    this.cleanManagedAssets(targetRoot);

    // Sync enabled toolkits
    const enabled = toolkits.filter(t => t.enabled);
    let syncedCount = 0;

    for (const toolkit of enabled) {
      for (const asset of toolkit.assets) {
        try {
          await this.syncAsset(asset, targetRoot, syncMethod);
          syncedCount++;
        } catch (err) {
          this.log(`Failed to sync asset ${asset.id}: ${err}`);
        }
      }
    }

    this.log(`Synced ${syncedCount} assets from ${enabled.length} toolkits to ${targetRoot}`);
    if (syncedCount > 0) {
      vscode.window.showInformationMessage(`AI Toolkit: Synced ${syncedCount} assets.`);
    }
  }

  /**
   * Sync a single toolkit's assets.
   */
  async syncToolkit(toolkit: Toolkit): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const config = vscode.workspace.getConfiguration('aiToolkit');
    const targetDir = config.get<string>('targetDirectory', '.github');
    const syncMethod = config.get<string>('syncMethod', 'symlink');
    const targetRoot = path.join(workspaceRoot, targetDir);

    for (const asset of toolkit.assets) {
      try {
        if (toolkit.enabled) {
          await this.syncAsset(asset, targetRoot, syncMethod);
        } else {
          await this.removeAsset(asset, targetRoot);
        }
      } catch (err) {
        this.log(`Failed to process asset ${asset.id}: ${err}`);
      }
    }
  }

  /**
   * Sync a single asset into the workspace.
   */
  private async syncAsset(asset: Asset, targetRoot: string, method: string): Promise<void> {
    const subdir = TARGET_SUBDIRS[asset.type];
    const targetDir = path.join(targetRoot, subdir);
    fs.mkdirSync(targetDir, { recursive: true });

    const targetName = asset.isFolder ? path.basename(asset.sourcePath) : path.basename(asset.sourcePath);
    const targetPath = path.join(targetDir, targetName);

    // Don't overwrite non-managed files
    if (fs.existsSync(targetPath) && !this.isManagedPath(targetPath)) {
      this.log(`Skipping ${targetPath} — not managed by AI Toolkit`);
      return;
    }

    // Remove existing before re-syncing
    this.removePath(targetPath);

    if (method === 'symlink') {
      fs.symlinkSync(asset.sourcePath, targetPath, asset.isFolder ? 'dir' : 'file');
    } else {
      if (asset.isFolder) {
        this.copyDirRecursive(asset.sourcePath, targetPath);
      } else {
        fs.copyFileSync(asset.sourcePath, targetPath);
      }
    }

    // Write a marker so we know we manage this path
    this.writeManagedMarker(targetPath);
  }

  /**
   * Remove a synced asset from the workspace.
   */
  private async removeAsset(asset: Asset, targetRoot: string): Promise<void> {
    const subdir = TARGET_SUBDIRS[asset.type];
    const targetName = path.basename(asset.sourcePath);
    const targetPath = path.join(targetRoot, subdir, targetName);

    if (fs.existsSync(targetPath) && this.isManagedPath(targetPath)) {
      this.removePath(targetPath);
      this.removeManagedMarker(targetPath);
    }
  }

  /**
   * Clean all managed assets from the target directory.
   */
  private cleanManagedAssets(targetRoot: string): void {
    const manifestPath = path.join(targetRoot, '.ai-toolkit-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return;
    }

    try {
      const manifest: string[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const managedPath of manifest) {
        const fullPath = path.join(targetRoot, managedPath);
        this.removePath(fullPath);
      }
      fs.unlinkSync(manifestPath);
    } catch {
      // Manifest corrupted, ignore
    }
  }

  /**
   * Track managed paths via a manifest file.
   */
  private writeManagedMarker(targetPath: string): void {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const config = vscode.workspace.getConfiguration('aiToolkit');
    const targetDir = config.get<string>('targetDirectory', '.github');
    const targetRoot = path.join(workspaceRoot, targetDir);
    const manifestPath = path.join(targetRoot, '.ai-toolkit-manifest.json');

    let manifest: string[] = [];
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        manifest = [];
      }
    }

    const relative = path.relative(targetRoot, targetPath);
    if (!manifest.includes(relative)) {
      manifest.push(relative);
    }
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  private removeManagedMarker(targetPath: string): void {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const config = vscode.workspace.getConfiguration('aiToolkit');
    const targetDir = config.get<string>('targetDirectory', '.github');
    const targetRoot = path.join(workspaceRoot, targetDir);
    const manifestPath = path.join(targetRoot, '.ai-toolkit-manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return;
    }

    try {
      let manifest: string[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const relative = path.relative(targetRoot, targetPath);
      manifest = manifest.filter(p => p !== relative);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch {
      // ignore
    }
  }

  private isManagedPath(targetPath: string): boolean {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return false;
    }

    const config = vscode.workspace.getConfiguration('aiToolkit');
    const targetDir = config.get<string>('targetDirectory', '.github');
    const targetRoot = path.join(workspaceRoot, targetDir);
    const manifestPath = path.join(targetRoot, '.ai-toolkit-manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return false;
    }

    try {
      const manifest: string[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const relative = path.relative(targetRoot, targetPath);
      return manifest.includes(relative);
    } catch {
      return false;
    }
  }

  private removePath(targetPath: string): void {
    try {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(targetPath);
      } else if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
    } catch {
      // Path doesn't exist, nothing to do
    }
  }

  private copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private log(msg: string): void {
    this.outputChannel.appendLine(`[AI Toolkit] ${msg}`);
  }
}
