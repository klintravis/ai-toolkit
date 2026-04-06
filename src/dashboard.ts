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
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
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
<header class="hero">
  <div class="hero-title">
    <h1>AI Toolkit</h1>
    <p class="tagline" id="tagline">Manage your Copilot toolkits and pinned assets.</p>
  </div>
  <div class="stats" id="stats"></div>
</header>

<section class="quick-actions">
  <button data-action="cloneToolkit" class="primary">+ Clone from GitHub</button>
  <button data-action="addToolkitPath">+ Add Folder</button>
  <button data-action="checkForUpdates">↻ Check Updates</button>
  <button data-action="updateAllToolkits">⬇ Update All</button>
  <button data-action="openPinsFolder">📂 Open Pins</button>
  <button data-action="openSettings">⚙ Settings</button>
</section>

<section class="pane">
  <div class="pane-header">
    <h2>Toolkits</h2>
    <span class="pane-count" id="toolkits-count"></span>
  </div>
  <div id="toolkits" class="toolkit-grid"></div>
</section>

<section class="pane">
  <div class="pane-header">
    <h2>Pick Groups</h2>
    <span class="pane-count" id="groups-count"></span>
    <div class="pane-actions">
      <button data-action="createGroup">+ New Group</button>
    </div>
  </div>
  <div id="groups" class="groups-list"></div>
</section>

<section class="pane info-pane">
  <div class="pane-header"><h2>Paths</h2></div>
  <div class="kv"><span class="k">Clone directory</span><span class="v" id="clone-dir">—</span></div>
  <div class="kv"><span class="k">Pins directory</span><span class="v" id="picks-dir">—</span></div>
  <div class="kv"><span class="k">Git</span><span class="v" id="git-status">—</span></div>
</section>

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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) { s += chars.charAt(Math.floor(Math.random() * chars.length)); }
  return s;
}

const STYLES = `
:root {
  --radius: 6px;
  --space: 12px;
}
body {
  margin: 0;
  padding: 0 24px 48px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
h1, h2 { margin: 0; font-weight: 600; }
h1 { font-size: 1.8em; letter-spacing: -0.02em; }
h2 { font-size: 1.1em; }
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 0 12px;
  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  margin-bottom: 20px;
  gap: 24px;
  flex-wrap: wrap;
}
.hero-title .tagline { margin: 4px 0 0; opacity: 0.7; font-size: 0.9em; }
.stats { display: flex; gap: 20px; }
.stat { text-align: center; min-width: 72px; }
.stat .num {
  font-size: 1.8em;
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
  line-height: 1;
}
.stat .label { font-size: 0.75em; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
.quick-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
button {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid var(--vscode-widget-border, transparent);
  padding: 6px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 0.9em;
  font-family: inherit;
  transition: background 0.1s;
}
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.danger { color: var(--vscode-errorForeground); }
.pane { margin-bottom: 24px; }
.pane-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}
.pane-count { opacity: 0.6; font-size: 0.9em; flex: 1; }
.pane-actions { display: flex; gap: 6px; }
.pane-actions button { padding: 4px 10px; font-size: 0.8em; }
.toolkit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.toolkit-card {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: var(--radius);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toolkit-card.enabled { border-left: 3px solid var(--vscode-charts-green); }
.toolkit-card.disabled { opacity: 0.75; }
.toolkit-card.has-update { border-left: 3px solid var(--vscode-charts-yellow); }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.card-title { font-weight: 600; font-size: 1.05em; }
.card-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.badge {
  font-size: 0.7em;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.badge.cloned { background: var(--vscode-charts-blue); color: white; }
.badge.update { background: var(--vscode-charts-yellow); color: black; }
.card-counts { font-size: 0.85em; opacity: 0.75; display: flex; gap: 10px; flex-wrap: wrap; }
.card-counts .chip { display: inline-flex; align-items: center; gap: 4px; }
.card-path { font-family: var(--vscode-editor-font-family); font-size: 0.75em; opacity: 0.5; word-break: break-all; }
.card-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.card-actions button { padding: 4px 10px; font-size: 0.8em; }
.groups-list { display: flex; flex-direction: column; gap: 16px; }
.group-card {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: var(--radius);
  padding: 14px;
}
.group-head {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.group-name { font-weight: 600; font-size: 1.1em; }
.group-meta { opacity: 0.7; font-size: 0.85em; flex: 1; }
.group-actions { display: flex; gap: 6px; }
.group-actions button { padding: 4px 10px; font-size: 0.8em; }
.picks-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.pick-card {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.pick-info { min-width: 0; flex: 1; }
.pick-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-meta { font-size: 0.75em; opacity: 0.7; display: flex; gap: 8px; margin-top: 2px; }
.pick-meta .chip { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 4px; }
.info-pane .kv { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.9em; border-bottom: 1px dashed var(--vscode-widget-border, rgba(128,128,128,0.15)); }
.info-pane .kv:last-child { border-bottom: none; }
.info-pane .k { opacity: 0.7; }
.info-pane .v { font-family: var(--vscode-editor-font-family); font-size: 0.85em; }
.empty { text-align: center; padding: 24px; opacity: 0.6; font-style: italic; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const ASSET_TYPE_ICONS = {
  agents: '🤖', instructions: '📖', skills: '🔧', prompts: '💬',
  plugins: '🧩', hooks: '⚡', workflows: '▶', standards: '⚖'
};

window.addEventListener('message', (e) => {
  if (e.data.type === 'state') render(e.data.state);
});

document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!target) return;
  const action = target.getAttribute('data-action');
  const payload = {};
  for (const key of ['toolkitId','rootPath','assetId','sourcePath','enabled','isFolder','groupName']) {
    const v = target.getAttribute('data-' + key.toLowerCase());
    if (v !== null) {
      payload[key] = v === 'true' ? true : v === 'false' ? false : v;
    }
  }
  vscode.postMessage({ type: action, ...payload });
});

function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('data-')) n.setAttribute(k, String(v));
      else n.setAttribute(k, String(v));
    }
  }
  for (const c of (children || [])) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function render(state) {
  const active = state.toolkits.filter(t => t.enabled).length;
  const updates = state.toolkits.filter(t => t.update && t.update.updateAvailable).length;
  document.getElementById('stats').innerHTML = '';
  document.getElementById('stats').append(
    stat(state.toolkits.length, 'Toolkits'),
    stat(active, 'Active'),
    stat(state.picks.length, 'Pinned'),
    stat(updates, 'Updates'),
  );

  document.getElementById('toolkits-count').textContent = state.toolkits.length + ' total';
  const grid = document.getElementById('toolkits');
  grid.innerHTML = '';
  if (state.toolkits.length === 0) {
    grid.append(el('div', { class: 'empty' }, ['No toolkits yet. Clone one from GitHub to get started.']));
  } else {
    for (const t of state.toolkits) grid.append(toolkitCard(t));
  }

  // Build groups: use groups list + distribute picks into them
  const groupsById = new Map();
  for (const name of state.groups) groupsById.set(name, []);
  for (const p of state.picks) {
    if (!groupsById.has(p.groupName)) groupsById.set(p.groupName, []);
    groupsById.get(p.groupName).push(p);
  }
  document.getElementById('groups-count').textContent = groupsById.size + ' group(s), ' + state.picks.length + ' pinned';
  const groupsEl = document.getElementById('groups');
  groupsEl.innerHTML = '';
  if (groupsById.size === 0) {
    groupsEl.append(el('div', { class: 'empty' }, ['No groups yet. Pin an asset from the tree or click "+ New Group" to create one.']));
  } else {
    for (const [name, picks] of groupsById.entries()) {
      groupsEl.append(groupCard(name, picks, state.toolkits));
    }
  }

  document.getElementById('clone-dir').textContent = state.cloneDir;
  document.getElementById('picks-dir').textContent = state.picksDir;
  document.getElementById('git-status').textContent = state.gitAvailable ? 'available on PATH' : 'not installed';
}

function stat(num, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'num', text: String(num) }),
    el('div', { class: 'label', text: label }),
  ]);
}

function toolkitCard(t) {
  const hasUpdate = t.update && t.update.updateAvailable;
  const classes = ['toolkit-card', t.enabled ? 'enabled' : 'disabled'];
  if (hasUpdate) classes.push('has-update');
  const badges = el('div', { class: 'card-badges' }, [
    t.enabled ? el('span', { class: 'badge', text: 'enabled' }) : null,
    t.isCloned ? el('span', { class: 'badge cloned', text: 'cloned' }) : null,
    hasUpdate ? el('span', { class: 'badge update', text: 'update ready' }) : null,
  ]);
  const counts = Object.entries(t.assetCountsByType).map(([type, n]) =>
    el('span', { class: 'chip' }, [(ASSET_TYPE_ICONS[type] || '•') + ' ' + n])
  );

  const actions = el('div', { class: 'card-actions' }, [
    el('button', {
      'data-action': 'toggleToolkit',
      'data-toolkitid': t.id,
      'data-enabled': (!t.enabled).toString(),
      text: t.enabled ? 'Disable' : 'Enable',
    }),
    hasUpdate ? el('button', {
      class: 'primary',
      'data-action': 'updateToolkit',
      'data-rootpath': t.rootPath,
      text: 'Update',
    }) : null,
    el('button', {
      class: 'danger',
      'data-action': 'removeToolkit',
      'data-rootpath': t.rootPath,
      text: 'Remove',
    }),
  ]);

  return el('div', { class: classes.join(' ') }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title', text: t.name }),
      badges,
    ]),
    el('div', { class: 'card-counts' }, counts),
    el('div', { class: 'card-path', text: t.rootPath }),
    actions,
  ]);
}

function groupCard(name, picks, toolkits) {
  // Find the synthetic toolkit for this group (if scanner has seen it).
  // Group toolkit rootPath ends with /<groupName>.
  const groupToolkit = toolkits.find(t =>
    t.rootPath.replace(/\\\\/g, '/').endsWith('/' + name) && t.name === name
  );
  const enabled = groupToolkit ? groupToolkit.enabled : false;
  const badges = el('div', { class: 'card-badges' }, [
    groupToolkit && enabled ? el('span', { class: 'badge', text: 'enabled' }) : null,
    !groupToolkit ? el('span', { class: 'badge', text: 'empty' }) : null,
  ]);
  const head = el('div', { class: 'group-head' }, [
    el('div', { class: 'group-name', text: '📁 ' + name }),
    badges,
    el('div', { class: 'group-meta', text: picks.length + ' pick' + (picks.length === 1 ? '' : 's') }),
    el('div', { class: 'group-actions' }, [
      groupToolkit ? el('button', {
        'data-action': 'toggleToolkit',
        'data-toolkitid': groupToolkit.id,
        'data-enabled': (!enabled).toString(),
        text: enabled ? 'Disable' : 'Enable',
      }) : null,
      el('button', {
        'data-action': 'renameGroup',
        'data-groupname': name,
        text: 'Rename',
      }),
      el('button', {
        class: 'danger',
        'data-action': 'deleteGroup',
        'data-groupname': name,
        text: 'Delete',
      }),
    ]),
  ]);
  const list = el('div', { class: 'picks-list' },
    picks.length === 0
      ? [el('div', { class: 'empty', text: 'No picks yet' })]
      : picks.map(pickCard)
  );
  return el('div', { class: 'group-card' }, [head, list]);
}

function pickCard(p) {
  return el('div', { class: 'pick-card' }, [
    el('div', { class: 'pick-info' }, [
      el('div', { class: 'pick-name', text: (ASSET_TYPE_ICONS[p.assetType] || '•') + ' ' + p.assetName }),
      el('div', { class: 'pick-meta' }, [
        el('span', { class: 'chip', text: p.assetType }),
        el('span', { text: 'from ' + p.toolkitName }),
        el('span', { text: '· ' + p.linkType }),
      ]),
    ]),
    el('div', { class: 'card-actions' }, [
      el('button', {
        'data-action': 'moveAsset',
        'data-assetid': p.assetId,
        text: 'Move',
      }),
      el('button', {
        'data-action': 'unpinAsset',
        'data-assetid': p.assetId,
        text: 'Unpin',
      }),
    ]),
  ]);
}

vscode.postMessage({ type: 'ready' });
`;
