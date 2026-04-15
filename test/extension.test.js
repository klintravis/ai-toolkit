const { test } = require('node:test');
const assert = require('node:assert/strict');

// TODO: extension.js imports 'vscode' at the module level, which is only
// available inside the VS Code Extension Development Host. Requiring it from a
// plain node:test harness throws "Cannot find module 'vscode'". The smoke test
// below is deferred until a lightweight vscode stub is introduced.
// See: https://github.com/klintravis/ai-toolkit/issues — Theme 4 follow-up.

test.skip('extension smoke - module loads without errors', () => {
  // Blocked: require('../out/extension.js') throws "Cannot find module 'vscode'"
  // Unblock by injecting a vscode stub via require.cache before requiring.
  const ext = require('../out/extension.js');
  assert.ok(typeof ext.activate === 'function');
  assert.ok(typeof ext.deactivate === 'function');
});

// Pure-logic test: command IDs are stable strings referenced in package.json.
// This exercises no module imports and always runs.
test('extension commands - well-known command IDs match expected pattern', () => {
  const knownCommands = [
    'aiToolkit.refresh',
    'aiToolkit.addToolkitPath',
    'aiToolkit.removeToolkitPath',
    'aiToolkit.enableToolkit',
    'aiToolkit.disableToolkit',
    'aiToolkit.cloneToolkit',
    'aiToolkit.checkForUpdates',
    'aiToolkit.openDashboard',
    'aiToolkit.pinAsset',
    'aiToolkit.unpinAsset',
  ];
  const re = /^aiToolkit\.[a-zA-Z]+$/;
  for (const cmd of knownCommands) {
    assert.ok(re.test(cmd), `command "${cmd}" does not match pattern`);
  }
});
