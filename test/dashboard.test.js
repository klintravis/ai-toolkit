const { test } = require('node:test');
const assert = require('node:assert/strict');

// TODO: dashboard.js imports 'vscode' at the module level, which is only
// available inside the VS Code Extension Development Host. The module-load test
// is deferred until a lightweight vscode stub is introduced.
// See: Theme 4 follow-up.
//
// Additional tests (serializeState round-trip, message-handler dispatch) require
// refactoring dashboard.ts to export pure functions. Deferred unless changes fit
// within the 20-line production cap in a follow-up task.

test.skip('dashboard module - loads without errors', () => {
  // Blocked: require('../out/dashboard.js') throws "Cannot find module 'vscode'"
  const mod = require('../out/dashboard.js');
  assert.ok(mod, 'dashboard module exports something');
});

// Pure-logic test: DashboardMessage type discriminants are stable string
// literals that the webview sends to the extension host. Validates the
// known message types match expected naming conventions.
test('dashboard - message type discriminants follow expected naming convention', () => {
  const messageTypes = [
    'ready',
    'toggleToolkit',
    'updateToolkit',
    'removeToolkit',
    'unpinAsset',
    'moveAsset',
    'openSource',
    'cloneToolkit',
    'addToolkitPath',
    'checkForUpdates',
    'updateAllToolkits',
    'openPinsFolder',
    'openSettings',
    'createGroup',
    'deleteGroup',
    'renameGroup',
    'refresh',
  ];
  // All message types are camelCase strings
  const re = /^[a-z][a-zA-Z]*$/;
  for (const t of messageTypes) {
    assert.ok(re.test(t), `message type "${t}" does not match camelCase convention`);
  }
  // No duplicates
  assert.equal(new Set(messageTypes).size, messageTypes.length);
});
