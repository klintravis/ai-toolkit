const { test } = require('node:test');
const assert = require('node:assert/strict');

// TODO: treeProvider.js imports 'vscode' at the module level, which is only
// available inside the VS Code Extension Development Host. The constructor and
// groupByFolder tests are deferred until a lightweight vscode stub is
// introduced. See: Theme 4 follow-up.
//
// Additionally, groupByFolder is private — making it callable from tests
// would require removing the 'private' keyword (1-word change within the cap)
// but is moot while the module can't be required.

test.skip('ToolkitTreeProvider - constructs without deps', () => {
  // Blocked: require('../out/treeProvider.js') throws "Cannot find module 'vscode'"
  const { ToolkitTreeProvider } = require('../out/treeProvider.js');
  const tp = new ToolkitTreeProvider();
  assert.ok(tp);
});

test.skip('groupByFolder - collapses non-platform prefixes to asset type', () => {
  // Blocked: module not requireable + groupByFolder is private.
  // Deferred — see Theme 4 follow-up.
});

// Pure-logic tests: contextValue regex patterns from package.json menus.
// These exercise no module imports and validate the shape of contextValue
// strings that the tree provider emits (used in when-clause guards).

test('contextValue regex - addToWorkspace pattern matches real toolkits only', () => {
  const re = /^toolkit-(enabled|disabled)-(cloned|external)$/;
  assert.ok(re.test('toolkit-enabled-cloned'));
  assert.ok(re.test('toolkit-disabled-external'));
  assert.ok(re.test('toolkit-enabled-external'));
  assert.ok(re.test('toolkit-disabled-cloned'));
  assert.ok(!re.test('toolkit-enabled-cloned-group'));
  assert.ok(!re.test('toolkit-group'));
  assert.ok(!re.test('asset-enabled'));
  assert.ok(!re.test('toolkit-enabled-cloned-updatable'));
});

test('contextValue regex - updateToolkit inline matches only updatable toolkits', () => {
  const re = /-updatable$/;
  assert.ok(re.test('toolkit-enabled-cloned-updatable'));
  assert.ok(re.test('toolkit-disabled-cloned-updatable'));
  assert.ok(!re.test('toolkit-enabled-cloned'));
  assert.ok(!re.test('toolkit-enabled-external'));
  assert.ok(!re.test('asset-enabled'));
});

test('contextValue regex - asset pin/unpin patterns are non-overlapping', () => {
  const pinRe = /^asset-(enabled|disabled)$/;
  const unpinRe = /-pinned$/;
  // A pinned asset should match unpin but not pin
  assert.ok(unpinRe.test('asset-enabled-pinned'));
  assert.ok(!pinRe.test('asset-enabled-pinned'));
  // An unpinned asset should match pin but not unpin
  assert.ok(pinRe.test('asset-enabled'));
  assert.ok(!unpinRe.test('asset-enabled'));
  // Disabled unpinned asset
  assert.ok(pinRe.test('asset-disabled'));
  assert.ok(!unpinRe.test('asset-disabled'));
});

test('contextValue regex - group deletion pattern matches group nodes', () => {
  const re = /^toolkit-.*-group/;
  assert.ok(re.test('toolkit-enabled-cloned-group'));
  assert.ok(re.test('toolkit-disabled-external-group'));
  assert.ok(!re.test('toolkit-enabled-cloned'));
  assert.ok(!re.test('asset-enabled'));
});
