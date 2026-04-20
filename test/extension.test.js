const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireFresh, withMockedVscode } = require('./helpers/mockVscode');

test('extension smoke - module loads without errors', () => {
  withMockedVscode(() => {
    const ext = requireFresh('./out/extension.js');
    assert.ok(typeof ext.activate === 'function');
    assert.ok(typeof ext.deactivate === 'function');
  });
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
