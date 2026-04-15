import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { PinRecord, Toolkit } from './types';

/** Snapshot of state rendered in the dashboard. */
export interface DashboardState {
  toolkits: Toolkit[];
  pins: PinRecord[];
  groups: string[];
  pinsDir: string;
  cloneDir: string;
  gitAvailable: boolean;
}

/** Messages the webview can send to the extension. */
export type DashboardMessage =
  | { type: 'ready' }
  | { type: 'toggleToolkit'; toolkitId: string; enabled: boolean }
  | { type: 'updateToolkit'; rootPath: string }
  | { type: 'removeToolkit'; rootPath: string }
  | { type: 'unpinAsset'; assetId: string }
  | { type: 'moveAsset'; assetId: string }
  | { type: 'openSource'; sourcePath: string; isFolder: boolean }
  | { type: 'cloneToolkit' }
  | { type: 'addToolkitPath' }
  | { type: 'checkForUpdates' }
  | { type: 'updateAllToolkits' }
  | { type: 'openPinsFolder' }
  | { type: 'openSettings' }
  | { type: 'createGroup' }
  | { type: 'deleteGroup'; groupName?: string }
  | { type: 'renameGroup'; groupName?: string }
  | { type: 'refresh' };

/** Handler provided by the extension for dashboard actions. */
export interface DashboardHost {
  getState(): DashboardState | Promise<DashboardState>;
  handle(msg: DashboardMessage): void | Promise<void>;
}

export class DashboardPanel {
  public static current: DashboardPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private panel: vscode.WebviewPanel,
    private host: DashboardHost,
    private extensionUri: vscode.Uri,
  ) {
    this.panel.webview.html = this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: DashboardMessage) => this.onMessage(msg),
      null,
      this.disposables
    );
  }

  static show(host: DashboardHost, extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.Active;
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      DashboardPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'aiToolkit.dashboard',
      'AI Toolkit',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.iconPath = new vscode.ThemeIcon('dashboard') as unknown as vscode.Uri;
    DashboardPanel.current = new DashboardPanel(panel, host, extensionUri);
  }

  async refresh(): Promise<void> {
    const state = await this.host.getState();
    this.panel.webview.postMessage({ type: 'state', state: serializeState(state) });
  }

  private async onMessage(msg: DashboardMessage): Promise<void> {
    if (msg.type === 'ready') {
      this.refresh();
      return;
    }
    await this.host.handle(msg);
    this.refresh();
  }

  dispose(): void {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  private render(): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
      "img-src data:",
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AI Toolkit</title>
<style>${STYLES}</style>
</head>
<body>
<div class="grain"></div>
<div class="dashboard">

  <header class="header">
    <div class="header-brand">
      <div class="logo">${LOGO_SVG}</div>
      <div>
        <h1>AI Toolkit</h1>
        <p class="subtitle">Copilot customization control</p>
      </div>
    </div>
    <div class="header-stats" id="stats"></div>
  </header>

  <nav class="action-bar">
    <div class="action-group">
      <button data-action="cloneToolkit" class="btn btn-primary"><span class="btn-icon">${ICO_CLONE}</span>Clone</button>
      <button data-action="addToolkitPath" class="btn btn-ghost"><span class="btn-icon">${ICO_FOLDER}</span>Add Folder</button>
    </div>
    <div class="action-group">
      <button data-action="checkForUpdates" class="btn btn-ghost"><span class="btn-icon">${ICO_REFRESH}</span>Check Updates</button>
      <button data-action="updateAllToolkits" class="btn btn-ghost"><span class="btn-icon">${ICO_DOWNLOAD}</span>Update All</button>
    </div>
    <div class="action-group action-group-end">
      <button data-action="openPinsFolder" class="btn btn-ghost"><span class="btn-icon">${ICO_PIN}</span>Pins</button>
      <button data-action="openSettings" class="btn btn-ghost"><span class="btn-icon">${ICO_GEAR}</span>Settings</button>
    </div>
  </nav>

  <section class="section" id="toolkits-section">
    <div class="section-header">
      <h2>Toolkits</h2>
      <span class="section-rule"></span>
      <span class="section-count" id="toolkits-count"></span>
    </div>
    <div id="toolkits" class="toolkit-grid"></div>
  </section>

  <section class="section" id="groups-section">
    <div class="section-header">
      <h2>Pin Groups</h2>
      <span class="section-rule"></span>
      <span class="section-count" id="groups-count"></span>
      <button data-action="createGroup" class="btn btn-ghost btn-sm"><span class="btn-icon">${ICO_PLUS}</span>New Group</button>
    </div>
    <div id="groups" class="groups-list"></div>
  </section>

  <footer class="system-bar">
    <div class="sys-item"><span class="sys-label">Clone</span><span class="sys-value" id="clone-dir"></span></div>
    <div class="sys-item"><span class="sys-label">Pins</span><span class="sys-value" id="picks-dir"></span></div>
    <div class="sys-item"><span class="sys-label">Git</span><span class="sys-value" id="git-status"></span></div>
  </footer>

</div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
  }
}

function serializeState(state: DashboardState): unknown {
  return {
    toolkits: state.toolkits.map(t => ({
      id: t.id,
      name: t.name,
      rootPath: t.rootPath,
      format: t.format,
      enabled: t.enabled,
      isCloned: !!t.isCloned,
      assetCount: t.assets.length,
      assetCountsByType: countByType(t.assets.map(a => a.type)),
      update: t.update ?? null,
    })),
    picks: state.pins.map(p => ({
      assetId: p.assetId,
      groupName: p.groupName,
      assetName: p.assetName,
      assetType: p.assetType,
      toolkitName: p.toolkitName,
      sourcePath: p.sourcePath,
      targetPath: p.targetPath,
      linkType: p.linkType,
      isFolder: p.isFolder,
    })),
    groups: state.groups,
    picksDir: state.pinsDir,
    cloneDir: state.cloneDir,
    gitAvailable: state.gitAvailable,
  };
}

function countByType(types: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of types) { out[t] = (out[t] ?? 0) + 1; }
  return out;
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/* ── Inline SVG icons for the HTML template ──────────── */
const SVG = (d: string, s = 16) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const LOGO_SVG = SVG('<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/><polyline points="2 15.5 12 8.5 22 15.5"/>', 22);
const ICO_CLONE = SVG('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>');
const ICO_FOLDER = SVG('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>');
const ICO_REFRESH = SVG('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>');
const ICO_DOWNLOAD = SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');
const ICO_PIN = SVG('<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24z"/>');
const ICO_GEAR = SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
const ICO_PLUS = SVG('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');

const STYLES = `
/* ── Design tokens ───────────────────────────────────── */
:root {
  --font-display: var(--vscode-font-family);
  --font-mono: var(--vscode-editor-font-family);
  --font-body: var(--vscode-font-family);
  --radius: 8px;
  --radius-lg: 12px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 36px;
  --accent-emerald: #10b981;
  --accent-emerald-dim: rgba(16,185,129,0.15);
  --accent-amber: #f59e0b;
  --accent-amber-dim: rgba(245,158,11,0.15);
  --accent-indigo: #818cf8;
  --accent-indigo-dim: rgba(129,140,248,0.15);
  --accent-rose: #f43f5e;
  --accent-rose-dim: rgba(244,63,94,0.12);
  --surface-0: var(--vscode-editor-background);
  --surface-1: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --surface-2: var(--vscode-editorWidget-background);
  --border: var(--vscode-widget-border, rgba(128,128,128,0.2));
  --border-subtle: rgba(128,128,128,0.08);
  --text-1: var(--vscode-foreground);
  --text-2: var(--vscode-descriptionForeground, rgba(128,128,128,0.8));
  --text-3: rgba(128,128,128,0.5);
  --glow-emerald: 0 0 12px rgba(16,185,129,0.3);
  --glow-amber: 0 0 12px rgba(245,158,11,0.3);
  --transition: 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

/* ── Reset & base ────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font-family: var(--font-body);
  font-size: var(--vscode-font-size, 13px);
  color: var(--text-1);
  background: var(--surface-0);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { margin: 0; font-family: var(--font-display); }

/* ── Grain overlay ───────────────────────────────────── */
.grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 9999; opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* ── Dashboard layout ────────────────────────────────── */
.dashboard {
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--space-lg) var(--space-lg) 64px;
}

/* ── Header ──────────────────────────────────────────── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
  padding-bottom: var(--space-lg);
  margin-bottom: var(--space-lg);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.header-brand {
  display: flex; align-items: center; gap: var(--space-md);
}
.header-brand .logo {
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent-emerald-dim), var(--accent-indigo-dim));
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.header-brand .logo svg { opacity: 0.9; }
.header-brand h1 {
  font-size: 1.5em; font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.header-brand .subtitle {
  margin: 2px 0 0; font-size: 0.8em; color: var(--text-3);
  font-family: var(--font-mono); letter-spacing: 0.02em;
}

/* ── Stats ───────────────────────────────────────────── */
.header-stats { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
.stat-pill {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: 6px 14px; border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.stat-pill:hover { border-color: var(--text-3); }
.stat-pill .stat-num {
  font-family: var(--font-mono); font-weight: 500;
  font-size: 1.15em; line-height: 1;
  letter-spacing: -0.02em;
}
.stat-pill .stat-label {
  font-size: 0.72em; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--text-3);
}
.stat-pill.stat-active .stat-num { color: var(--accent-emerald); }
.stat-pill.stat-active { border-color: rgba(16,185,129,0.25); }
.stat-pill.stat-updates .stat-num { color: var(--accent-amber); }
.stat-pill.stat-updates { border-color: rgba(245,158,11,0.25); }
.stat-pill.stat-pinned .stat-num { color: var(--accent-indigo); }

/* ── Buttons ─────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: var(--radius);
  font-family: var(--font-body); font-size: 0.82em; font-weight: 500;
  cursor: pointer; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text-1);
  transition: all var(--transition);
  white-space: nowrap;
}
.btn:hover { border-color: var(--text-3); background: var(--surface-1); }
.btn:active { transform: scale(0.97); }
.btn-icon { display: flex; align-items: center; opacity: 0.65; }
.btn:hover .btn-icon { opacity: 1; }
.btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: transparent;
}
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn-ghost { background: transparent; border-color: transparent; }
.btn-ghost:hover { background: var(--surface-2); border-color: var(--border); }
.btn-sm { padding: 4px 10px; font-size: 0.75em; }
.btn-danger { color: var(--accent-rose); }
.btn-danger:hover { background: var(--accent-rose-dim); border-color: rgba(244,63,94,0.3); }
.btn-toggle {
  font-family: var(--font-mono); font-size: 0.72em; letter-spacing: 0.04em;
  text-transform: uppercase; padding: 4px 10px;
}
.btn-toggle.is-on { color: var(--accent-emerald); border-color: rgba(16,185,129,0.3); }
.btn-toggle.is-on:hover { background: var(--accent-emerald-dim); }
.btn-update {
  color: var(--accent-amber); border-color: rgba(245,158,11,0.3);
}
.btn-update:hover { background: var(--accent-amber-dim); }

/* ── Action bar ──────────────────────────────────────── */
.action-bar {
  display: flex; gap: var(--space-sm); flex-wrap: wrap;
  padding-bottom: var(--space-xl);
  align-items: center;
}
.action-group { display: flex; gap: var(--space-xs); }
.action-group-end { margin-left: auto; }

/* ── Sections ────────────────────────────────────────── */
.section { margin-bottom: var(--space-xl); }
.section-header {
  display: flex; align-items: center; gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.section-header h2 {
  font-size: 0.78em; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-3); white-space: nowrap;
}
.section-rule {
  flex: 1; height: 1px;
  background: linear-gradient(to right, var(--border), transparent);
}
.section-count {
  font-family: var(--font-mono); font-size: 0.75em;
  color: var(--text-3); white-space: nowrap;
}

/* ── Toolkit grid ────────────────────────────────────── */
.toolkit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-md);
}

/* ── Toolkit card ────────────────────────────────────── */
.tk-card {
  position: relative;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-md) var(--space-md) var(--space-md) var(--space-md);
  display: flex; flex-direction: column; gap: 10px;
  transition: all var(--transition);
  animation: cardIn 0.35s ease-out backwards;
  animation-delay: calc(var(--i, 0) * 50ms);
  overflow: hidden;
}
.tk-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; border-radius: 3px 0 0 3px;
  transition: background var(--transition), box-shadow var(--transition);
}
.tk-card:hover {
  border-color: var(--text-3);
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
}
.tk-card.is-enabled::before { background: var(--accent-emerald); box-shadow: var(--glow-emerald); }
.tk-card.is-disabled { opacity: 0.7; }
.tk-card.is-disabled::before { background: var(--border); }
.tk-card.has-update::before { background: var(--accent-amber); box-shadow: var(--glow-amber); }

.tk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-sm); }
.tk-title {
  font-family: var(--font-display); font-weight: 600; font-size: 1.05em;
  line-height: 1.2;
}
.tk-badges { display: flex; gap: var(--space-xs); flex-shrink: 0; }
.tk-badge {
  font-family: var(--font-mono); font-size: 0.62em; font-weight: 500;
  padding: 2px 8px; border-radius: 6px;
  text-transform: uppercase; letter-spacing: 0.06em;
  border: 1px solid var(--border);
}
.tk-badge-cloned { color: var(--accent-indigo); border-color: rgba(129,140,248,0.3); background: var(--accent-indigo-dim); }
.tk-badge-update { color: var(--accent-amber); border-color: rgba(245,158,11,0.3); background: var(--accent-amber-dim); }

.tk-assets {
  display: flex; gap: var(--space-sm); flex-wrap: wrap;
}
.tk-asset-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 0.78em; color: var(--text-2);
}
.tk-asset-chip svg { opacity: 0.6; }

.tk-path {
  font-family: var(--font-mono); font-size: 0.7em;
  color: var(--text-3); word-break: break-all;
  line-height: 1.4;
}

.tk-actions { display: flex; gap: var(--space-xs); flex-wrap: wrap; margin-top: 2px; }

/* ── Status dot ──────────────────────────────────────── */
.status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  display: inline-block; flex-shrink: 0;
}
.status-dot.dot-on { background: var(--accent-emerald); box-shadow: 0 0 6px rgba(16,185,129,0.5); animation: pulse 2.5s ease-in-out infinite; }
.status-dot.dot-off { background: var(--text-3); }
.status-dot.dot-update { background: var(--accent-amber); box-shadow: 0 0 6px rgba(245,158,11,0.5); animation: pulse 2s ease-in-out infinite; }

/* ── Groups ──────────────────────────────────────────── */
.groups-list { display: flex; flex-direction: column; gap: var(--space-md); }
.group-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  animation: cardIn 0.35s ease-out backwards;
  animation-delay: calc(var(--i, 0) * 50ms);
  transition: border-color var(--transition);
}
.group-card:hover { border-color: var(--text-3); }
.group-head {
  display: flex; align-items: center; gap: var(--space-md);
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
}
.group-name-wrap { display: flex; align-items: center; gap: var(--space-sm); }
.group-name {
  font-family: var(--font-display); font-weight: 600; font-size: 1.05em;
}
.group-meta {
  font-family: var(--font-mono); font-size: 0.72em;
  color: var(--text-3); flex: 1;
}
.group-actions { display: flex; gap: var(--space-xs); }

/* ── Pin cards ───────────────────────────────────────── */
.pins-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--space-sm);
}
.pin-card {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: 8px 12px; border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: rgba(128,128,128,0.03);
  transition: all var(--transition);
}
.pin-card:hover { border-color: var(--border); background: rgba(128,128,128,0.06); }
.pin-icon { display: flex; color: var(--text-3); flex-shrink: 0; }
.pin-info { flex: 1; min-width: 0; }
.pin-name {
  font-weight: 500; font-size: 0.88em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pin-meta {
  font-size: 0.7em; color: var(--text-3);
  font-family: var(--font-mono);
  display: flex; gap: var(--space-sm);
}
.pin-type-badge {
  font-size: 0.65em; font-family: var(--font-mono); text-transform: uppercase;
  letter-spacing: 0.04em; padding: 1px 6px; border-radius: 4px;
  background: rgba(128,128,128,0.1); color: var(--text-2);
}
.pin-actions { display: flex; gap: 2px; flex-shrink: 0; }

/* ── System bar ──────────────────────────────────────── */
.system-bar {
  display: flex; gap: var(--space-lg); flex-wrap: wrap;
  padding: var(--space-md) 0;
  border-top: 1px solid var(--border-subtle);
  margin-top: var(--space-xl);
}
.sys-item { display: flex; gap: var(--space-sm); align-items: baseline; }
.sys-label {
  font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--text-3); font-family: var(--font-display); font-weight: 600;
}
.sys-value {
  font-family: var(--font-mono); font-size: 0.75em; color: var(--text-2);
}
.sys-dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  margin-right: 4px; vertical-align: middle;
}
.sys-dot.ok { background: var(--accent-emerald); box-shadow: 0 0 4px rgba(16,185,129,0.4); }
.sys-dot.err { background: var(--accent-rose); }

/* ── Empty states ────────────────────────────────────── */
.empty-state {
  text-align: center; padding: var(--space-xl) var(--space-lg);
  color: var(--text-3); font-size: 0.9em;
}
.empty-state .empty-icon { font-size: 2em; margin-bottom: var(--space-sm); opacity: 0.3; }
.empty-state p { margin: 0 0 var(--space-md); max-width: 360px; margin-inline: auto; line-height: 1.6; }

/* ── Animations ──────────────────────────────────────── */
@keyframes cardIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.dashboard { animation: fadeIn 0.3s ease-out; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();

/* ── SVG icon fragments (Lucide-style, 16x16) ───────── */
function ico(paths, size) {
  size = size || 14;
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
}
const ASSET_ICONS = {
  agents:       ico('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/><path d="M9.5 16a5 5 0 0 0 5 0"/>'),
  instructions: ico('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/>'),
  skills:       ico('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.7a6 6 0 0 1-7.7 7.7L6.9 20a2.1 2.1 0 0 1-3-3l6.8-6.8a6 6 0 0 1 7.7-7.7l-3.7 3.8z"/>'),
  prompts:      ico('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  plugins:      ico('<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/>'),
  hooks:        ico('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
  workflows:    ico('<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>'),
  standards:    ico('<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 8v4l3 3"/>'),
};

/* ── DOM helpers ─────────────────────────────────────── */
function el(tag, attrs, children) {
  var n = document.createElement(tag);
  if (attrs) {
    for (var k in attrs) {
      var v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('data-')) n.setAttribute(k, String(v));
      else n.setAttribute(k, String(v));
    }
  }
  for (var c of (children || [])) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

/* ── Event handling ──────────────────────────────────── */
window.addEventListener('message', function(e) {
  if (e.data.type === 'state') render(e.data.state);
});

document.addEventListener('click', function(e) {
  var target = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!target) return;
  var action = target.getAttribute('data-action');
  var payload = {};
  var keys = ['toolkitId','rootPath','assetId','sourcePath','enabled','isFolder','groupName'];
  for (var i = 0; i < keys.length; i++) {
    var v = target.getAttribute('data-' + keys[i].toLowerCase());
    if (v !== null) payload[keys[i]] = v === 'true' ? true : v === 'false' ? false : v;
  }
  vscode.postMessage(Object.assign({ type: action }, payload));
});

/* ── Main render ─────────────────────────────────────── */
function render(state) {
  var active = state.toolkits.filter(function(t){ return t.enabled; }).length;
  var updates = state.toolkits.filter(function(t){ return t.update && t.update.updateAvailable; }).length;

  /* Stats */
  var statsEl = document.getElementById('stats');
  statsEl.innerHTML = '';
  statsEl.append(
    statPill(state.toolkits.length, 'Toolkits', ''),
    statPill(active, 'Active', 'stat-active'),
    statPill(state.picks.length, 'Pinned', 'stat-pinned'),
    statPill(updates, 'Updates', updates > 0 ? 'stat-updates' : '')
  );

  /* Toolkits */
  document.getElementById('toolkits-count').textContent = state.toolkits.length + ' total';
  var grid = document.getElementById('toolkits');
  grid.innerHTML = '';
  if (state.toolkits.length === 0) {
    grid.append(emptyState(
      ico('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>', 32),
      'No toolkits yet',
      'Clone a repository from GitHub or add a local folder to get started.'
    ));
  } else {
    state.toolkits.forEach(function(t, i) { grid.append(toolkitCard(t, i)); });
  }

  /* Groups */
  var groupsById = new Map();
  state.groups.forEach(function(name){ groupsById.set(name, []); });
  state.picks.forEach(function(p) {
    if (!groupsById.has(p.groupName)) groupsById.set(p.groupName, []);
    groupsById.get(p.groupName).push(p);
  });
  document.getElementById('groups-count').textContent =
    groupsById.size + ' group' + (groupsById.size === 1 ? '' : 's') + '  /  ' + state.picks.length + ' pinned';
  var groupsEl = document.getElementById('groups');
  groupsEl.innerHTML = '';
  if (groupsById.size === 0) {
    groupsEl.append(emptyState(
      ico('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 32),
      'No pin groups',
      'Pin assets from the sidebar tree view, or create a new group to organize your favorites.'
    ));
  } else {
    var gi = 0;
    groupsById.forEach(function(picks, name) {
      groupsEl.append(groupCard(name, picks, state.toolkits, gi++));
    });
  }

  /* System bar */
  document.getElementById('clone-dir').textContent = state.cloneDir;
  document.getElementById('picks-dir').textContent = state.picksDir;
  var gitEl = document.getElementById('git-status');
  gitEl.innerHTML = '';
  var dot = el('span', { class: 'sys-dot ' + (state.gitAvailable ? 'ok' : 'err') });
  gitEl.append(dot, document.createTextNode(state.gitAvailable ? 'available' : 'not found'));
}

/* ── Components ──────────────────────────────────────── */
function statPill(num, label, cls) {
  return el('div', { class: 'stat-pill ' + cls }, [
    el('span', { class: 'stat-num', text: String(num) }),
    el('span', { class: 'stat-label', text: label }),
  ]);
}

function emptyState(icon, title, desc) {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'empty-icon', html: icon }),
    el('p', null, [el('strong', { text: title }), document.createTextNode(' — ' + desc)]),
  ]);
}

function toolkitCard(t, index) {
  var hasUpdate = t.update && t.update.updateAvailable;
  var classes = ['tk-card'];
  classes.push(t.enabled ? 'is-enabled' : 'is-disabled');
  if (hasUpdate) classes.push('has-update');

  var badges = el('div', { class: 'tk-badges' }, [
    t.isCloned ? el('span', { class: 'tk-badge tk-badge-cloned', text: 'cloned' }) : null,
    hasUpdate ? el('span', { class: 'tk-badge tk-badge-update', text: 'update' }) : null,
  ]);

  var assets = el('div', { class: 'tk-assets' });
  Object.entries(t.assetCountsByType).forEach(function(entry) {
    var type = entry[0], n = entry[1];
    assets.append(el('span', { class: 'tk-asset-chip', html: (ASSET_ICONS[type] || '') + ' ' + n }));
  });

  var toggleCls = 'btn btn-sm btn-toggle ' + (t.enabled ? 'is-on' : '');
  var actions = el('div', { class: 'tk-actions' }, [
    el('button', {
      class: toggleCls,
      'data-action': 'toggleToolkit',
      'data-toolkitid': t.id,
      'data-enabled': (!t.enabled).toString(),
      text: t.enabled ? 'Enabled' : 'Disabled',
    }),
    hasUpdate ? el('button', {
      class: 'btn btn-sm btn-update',
      'data-action': 'updateToolkit',
      'data-rootpath': t.rootPath,
      text: 'Pull Update',
    }) : null,
    el('button', {
      class: 'btn btn-sm btn-ghost btn-danger',
      'data-action': 'removeToolkit',
      'data-rootpath': t.rootPath,
      text: 'Remove',
    }),
  ]);

  var card = el('div', { class: classes.join(' ') }, [
    el('div', { class: 'tk-head' }, [
      el('div', { class: 'tk-title', text: t.name }),
      badges,
    ]),
    assets,
    el('div', { class: 'tk-path', text: t.rootPath }),
    actions,
  ]);
  card.style.setProperty('--i', String(index));
  return card;
}

function groupCard(name, picks, toolkits, index) {
  var groupToolkit = toolkits.find(function(t) {
    return t.rootPath.replace(/\\\\\\\\/g, '/').endsWith('/' + name) && t.name === name;
  });
  var enabled = groupToolkit ? groupToolkit.enabled : false;

  var dotCls = 'status-dot ' + (enabled ? 'dot-on' : 'dot-off');

  var head = el('div', { class: 'group-head' }, [
    el('div', { class: 'group-name-wrap' }, [
      el('span', { class: dotCls }),
      el('span', { class: 'group-name', text: name }),
    ]),
    el('span', { class: 'group-meta', text: picks.length + ' pin' + (picks.length === 1 ? '' : 's') }),
    el('div', { class: 'group-actions' }, [
      groupToolkit ? el('button', {
        class: 'btn btn-sm btn-toggle ' + (enabled ? 'is-on' : ''),
        'data-action': 'toggleToolkit',
        'data-toolkitid': groupToolkit.id,
        'data-enabled': (!enabled).toString(),
        text: enabled ? 'On' : 'Off',
      }) : null,
      el('button', {
        class: 'btn btn-sm btn-ghost',
        'data-action': 'renameGroup',
        'data-groupname': name,
        text: 'Rename',
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost btn-danger',
        'data-action': 'deleteGroup',
        'data-groupname': name,
        text: 'Delete',
      }),
    ]),
  ]);

  var list;
  if (picks.length === 0) {
    list = el('div', { class: 'empty-state', style: 'padding: 16px;' }, [
      el('p', { text: 'No pins in this group yet.', style: 'margin:0;opacity:0.5;font-size:0.85em;' }),
    ]);
  } else {
    list = el('div', { class: 'pins-grid' }, picks.map(pinCard));
  }

  var card = el('div', { class: 'group-card' }, [head, list]);
  card.style.setProperty('--i', String(index));
  return card;
}

function pinCard(p) {
  return el('div', { class: 'pin-card' }, [
    el('span', { class: 'pin-icon', html: ASSET_ICONS[p.assetType] || '' }),
    el('div', { class: 'pin-info' }, [
      el('div', { class: 'pin-name', text: p.assetName }),
      el('div', { class: 'pin-meta' }, [
        el('span', { class: 'pin-type-badge', text: p.assetType }),
        el('span', { text: p.toolkitName }),
      ]),
    ]),
    el('div', { class: 'pin-actions' }, [
      el('button', {
        class: 'btn btn-sm btn-ghost',
        'data-action': 'moveAsset',
        'data-assetid': p.assetId,
        text: 'Move',
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost btn-danger',
        'data-action': 'unpinAsset',
        'data-assetid': p.assetId,
        text: 'Unpin',
      }),
    ]),
  ]);
}

vscode.postMessage({ type: 'ready' });
`;
