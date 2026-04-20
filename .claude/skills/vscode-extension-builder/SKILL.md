---
name: vscode-extension-builder
description: Use when building, modifying, or debugging a VS Code extension — covers the package.json manifest, activation events, command/tree-view/settings contributions, the Extension Host API, testing with node:test, and packaging with vsce. Tailored to strict-TypeScript, CommonJS, ES2022 projects.
---

# VS Code Extension Builder

A practical reference for building VS Code extensions. Use this skill whenever the
task involves `package.json` `contributes`, the `vscode` API, activation events,
tree views, settings, commands, output channels, or packaging with `vsce`.

## Project shape

A minimal extension has:

```
my-ext/
├── package.json          # manifest + contributes + scripts
├── tsconfig.json         # strict TS, target ES2022, module CommonJS
├── src/extension.ts      # activate() / deactivate() entry
├── out/                  # tsc output (gitignored)
├── .vscodeignore         # excluded from .vsix
└── test/                 # node:test files (plain .js or compiled)
```

**tsconfig.json essentials:**
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", ".vscode-test", "out", "test"]
}
```

## package.json manifest

The manifest declares everything VS Code needs to load the extension without
executing any code. Prefer narrow activation events — broad ones slow startup.

```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "version": "0.1.0",
  "publisher": "your-publisher-id",
  "engines": { "vscode": "^1.85.0" },
  "main": "./out/extension.js",
  "activationEvents": [
    "onCommand:myExt.doThing",
    "onView:myExtView"
  ],
  "contributes": {
    "commands": [
      { "command": "myExt.doThing", "title": "My Ext: Do Thing" }
    ],
    "views": {
      "explorer": [
        { "id": "myExtView", "name": "My Ext" }
      ]
    },
    "configuration": {
      "title": "My Extension",
      "properties": {
        "myExt.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable the extension",
          "scope": "application"
        }
      }
    },
    "menus": {
      "view/item/context": [
        {
          "command": "myExt.doThing",
          "when": "view == myExtView && viewItem == myItem",
          "group": "inline"
        }
      ]
    }
  },
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src --ext ts",
    "test": "npm run compile && node --test test/",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "@vscode/vsce": "^2.20.0",
    "eslint": "^8.0.0",
    "typescript": "^5.3.0"
  }
}
```

## extension.ts entry

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('My Extension');
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand('myExt.doThing', async () => {
      outputChannel.appendLine('doThing invoked');
      await vscode.window.showInformationMessage('Hello');
    }),
  );
}

export function deactivate(): void {
  // Cleanup happens via context.subscriptions disposal.
}
```

**Every disposable belongs on `context.subscriptions`.** Failing to register them
leaks event listeners across reloads during development.

## Tree views

Tree views are the most common extension UI. Implement `TreeDataProvider` and
push nodes through an `EventEmitter` when data changes.

```typescript
export class MyTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: Node[] = [];

  setItems(items: Node[]): void {
    this.items = items;
    this.refresh();
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }
  dispose(): void { this._onDidChangeTreeData.dispose(); }

  getTreeItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('file');
    item.tooltip = node.detail;
    item.contextValue = 'myNode'; // used in menus when-clauses
    item.command = { command: 'myExt.openNode', title: 'Open', arguments: [node] };
    return item;
  }

  getChildren(element?: Node): Node[] {
    return element ? [] : this.items;
  }
}

// In activate():
const provider = new MyTreeProvider();
context.subscriptions.push(
  vscode.window.registerTreeDataProvider('myExtView', provider),
  provider, // provider itself implements Disposable
);
```

**Key gotchas:**
- Use `TreeItemCollapsibleState.Collapsed` for nodes whose children are loaded
  lazily; `Expanded` for initially-open. `None` means leaf — no expand arrow.
- `contextValue` drives the `viewItem == foo` clauses in `menus` contributions.
- Fire `onDidChangeTreeData` with a specific node to refresh just that subtree,
  or with `undefined` to refresh everything.

## Commands

- Register via `vscode.commands.registerCommand` and push the returned
  `Disposable` onto `context.subscriptions`.
- Commands take any JSON-serializable arguments. Tree items pass them via the
  `command.arguments` field.
- Always declare the command in `contributes.commands` even if it's never shown
  in the palette — otherwise `vscode.commands.executeCommand` still works but
  the Command Palette won't find it.

## Settings

**Reading:**
```typescript
const cfg = vscode.workspace.getConfiguration('myExt');
const enabled = cfg.get<boolean>('enabled', true);
```

**Writing — choose the scope deliberately:**
```typescript
await cfg.update('enabled', false, vscode.ConfigurationTarget.Global);     // user settings
await cfg.update('enabled', false, vscode.ConfigurationTarget.Workspace);  // workspace
```

**Reacting to changes:**
```typescript
context.subscriptions.push(
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('myExt.enabled')) { /* re-apply */ }
  }),
);
```

Rules of thumb:
- `"scope": "application"` in the manifest = one value for the whole IDE.
- `"scope": "machine"` = per-machine, ignored by settings sync.
- Default is `"window"` = overridable per-workspace.

## Output channels vs notifications

- **Notifications** (`showInformationMessage`, `showWarningMessage`, etc.) are
  modal-ish; use sparingly for events the user must acknowledge.
- **Output channels** (`createOutputChannel`) are for diagnostic logs. Users
  open them when something goes wrong. Prefer these for debug output.
- **Status bar** (`createStatusBarItem`) is for persistent state a user wants
  always visible (active mode, counts, sync state).

## Running & debugging

- Press **F5** in VS Code with the extension folder open to launch an
  Extension Development Host — a second VS Code window with your extension
  loaded. `console.log` goes to the parent window's Debug Console.
- Set breakpoints in `.ts` files; source maps handle the rest.
- `Ctrl+R` in the Dev Host reloads the extension after a recompile.
- Run a watch build (`tsc -watch`) in the background so reloads pick up
  changes automatically.

## Testing

**Prefer Node's built-in test runner** (`node:test` + `node:assert/strict`)
over the `@vscode/test-electron` harness whenever possible — it's faster,
simpler, and doesn't require a VS Code download. Use it for everything that
doesn't touch the `vscode` namespace directly (scanners, parsers, path
utilities, state machines).

```javascript
// test/scanner.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolkitScanner } = require('../out/scanner');

test('scans an empty dir', async () => {
  const scanner = new ToolkitScanner();
  const result = await scanner.scanPath('/nonexistent', {});
  assert.deepEqual(result, []);
});
```

Only reach for `@vscode/test-electron` when you genuinely need the Extension
Host (e.g. testing actual tree rendering or command registration).

**Decoupling for testability:** keep the bulk of your logic in plain TS modules
that import from `vscode` only through small interfaces you define yourself.
Example: a `PinRecordStore` class that takes `{ globalState: { get, update } }`
instead of the full `ExtensionContext` — now it's trivially mockable.

## Packaging

```bash
npm install -g @vscode/vsce   # once
vsce package                   # produces my-extension-0.1.0.vsix
vsce publish                   # publishes to the Marketplace (needs PAT)
```

`.vscodeignore` controls what ends up in the `.vsix`:
```
.vscode/**
.vscode-test/**
src/**
test/**
out/test/**
**/*.map
**/*.ts
.eslintrc.*
tsconfig.json
```

**Always ignore `src/` and `**/*.ts`** — ship only the compiled `out/` JS.

## Cross-platform paths

Always normalize paths to forward slashes internally and convert only when
calling OS APIs. When storing paths in settings, convert absolute paths under
the user's home directory to `~/…` form so settings sync across machines.

```typescript
import * as os from 'os';
import * as path from 'path';

export function toHomeRelative(p: string): string {
  const home = os.homedir();
  const norm = path.resolve(p).replace(/\\/g, '/');
  const normHome = home.replace(/\\/g, '/');
  return norm.startsWith(normHome + '/') ? '~' + norm.slice(normHome.length) : norm;
}

export function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}
```

## Security & sandboxing

- **Never shell out with `shell: true`.** Use `child_process.spawn` with an
  argv array so arguments can't be interpreted as shell metacharacters.
- **Reject symlinks that escape the project root** when walking user-supplied
  folder trees — resolve `realpath` and check the result is still under the
  expected root.
- **Validate paths against path traversal**: after `path.join(root, userInput)`
  verify the result still starts with `root` (both normalized).
- **Treat manifest files as untrusted input** — validate JSON shape before
  using any field.

## Common pitfalls

- **Forgetting activation events** → the command is declared but the extension
  never loads, so invoking it does nothing. Add an `onCommand:` entry (or use
  `"activationEvents": []` with VS Code 1.74+ auto-activation for most cases).
- **Mutating `context.globalState` without `await`** → the state doesn't
  persist across reloads. `update()` returns a `Thenable` — await it.
- **Using `workspace.getConfiguration()` once and caching** → misses user
  changes. Re-read on demand, or subscribe to `onDidChangeConfiguration`.
- **Writing to workspace settings unconditionally** → breaks for users without
  an open workspace. Guard with `vscode.workspace.workspaceFolders`.
- **Registering tree providers inside a command handler** → duplicates them
  every time the command fires. Register once in `activate()`.

## Checklist

Before shipping:
- [ ] `npm run compile` clean (strict mode, no errors)
- [ ] `npm run lint` clean
- [ ] `npm test` passes
- [ ] Manual smoke-test in Extension Development Host
- [ ] `CHANGELOG.md` updated
- [ ] `package.json` version bumped
- [ ] `.vscodeignore` excludes `src/`, `test/`, `*.ts`, `*.map`
- [ ] `vsce package` produces a `.vsix` under ~5MB (check what got bundled)
- [ ] `README.md` has install + usage instructions

## When to reach for what

| Need | Use |
|---|---|
| Custom sidebar UI | `TreeDataProvider` + `contributes.views` |
| Rich HTML UI | `WebviewPanel` (heavier; needs CSP) |
| Arbitrary file format | `FileSystemProvider` |
| Language features | `LanguageClient` + LSP server |
| Persistent state | `context.globalState` / `context.workspaceState` |
| Secrets (tokens) | `context.secrets` (never `globalState`) |
| Run external tool | `child_process.spawn` (never `shell: true`) |
| Background work | `withProgress` for visible tasks; bare async otherwise |
