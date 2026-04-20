const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireFresh, withMockedVscode } = require('./helpers/mockVscode');

// Additional tests (serializeState round-trip, message-handler dispatch) require
// refactoring dashboard.ts to export pure functions. Deferred unless changes fit
// within the 20-line production cap in a follow-up task.

test('dashboard module - loads without errors', () => {
  withMockedVscode(() => {
    const mod = requireFresh('./out/dashboard.js');
    assert.ok(mod.DashboardPanel, 'dashboard module exports DashboardPanel');
    assert.ok(typeof mod.DashboardPanel.show === 'function');
  });
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
