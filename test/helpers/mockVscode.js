const Module = require('node:module');
const path = require('node:path');

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      if (typeof listener !== 'function') {
        return { dispose() {} };
      }
      this.listeners.push(listener);
      return {
        dispose: () => {
          this.listeners = this.listeners.filter(candidate => candidate !== listener);
        },
      };
    };
  }

  fire(value) {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  dispose() {
    this.listeners = [];
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

function createVscodeMock(overrides = {}) {
  const base = {
    EventEmitter,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 1 },
    ViewColumn: { Active: 1 },
    Uri: {
      file: (fsPath) => ({ fsPath }),
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async () => undefined,
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (_key, fallback) => fallback,
        update: async () => undefined,
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      updateWorkspaceFolders: () => true,
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      createStatusBarItem: () => ({ show() {}, dispose() {}, text: '', tooltip: '', command: undefined }),
      createTreeView: () => ({ dispose() {} }),
      createWebviewPanel: () => ({
        webview: {
          html: '',
          onDidReceiveMessage: () => ({ dispose() {} }),
          postMessage: async () => undefined,
        },
        onDidDispose: () => ({ dispose() {} }),
        reveal() {},
        dispose() {},
      }),
      createTerminal: () => ({ show() {}, dispose() {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      showTextDocument: async () => undefined,
      showOpenDialog: async () => undefined,
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      withProgress: async (_options, task) => task({ report() {} }),
    },
  };

  return {
    ...base,
    ...overrides,
    Uri: { ...base.Uri, ...overrides.Uri },
    commands: { ...base.commands, ...overrides.commands },
    workspace: { ...base.workspace, ...overrides.workspace },
    window: { ...base.window, ...overrides.window },
    ViewColumn: { ...base.ViewColumn, ...overrides.ViewColumn },
    ProgressLocation: { ...base.ProgressLocation, ...overrides.ProgressLocation },
    StatusBarAlignment: { ...base.StatusBarAlignment, ...overrides.StatusBarAlignment },
    ConfigurationTarget: { ...base.ConfigurationTarget, ...overrides.ConfigurationTarget },
    TreeItemCollapsibleState: { ...base.TreeItemCollapsibleState, ...overrides.TreeItemCollapsibleState },
  };
}

function requireFresh(modulePath) {
  const resolved = require.resolve(path.resolve(process.cwd(), modulePath));
  delete require.cache[resolved];
  return require(resolved);
}

function withMockedVscode(run, overrides = {}) {
  const originalLoad = Module._load;
  const mock = createVscodeMock(overrides);

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') {
      return mock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const result = run(mock);
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        Module._load = originalLoad;
      });
    }
    Module._load = originalLoad;
    return result;
  } catch (error) {
    Module._load = originalLoad;
    throw error;
  }
}

module.exports = {
  createVscodeMock,
  requireFresh,
  withMockedVscode,
};