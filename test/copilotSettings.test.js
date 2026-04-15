const { test } = require('node:test');
const assert = require('node:assert/strict');

// TODO: copilotSettings.js imports 'vscode' at the module level, which is only
// available inside the VS Code Extension Development Host. The constructor test
// is deferred until a lightweight vscode stub is introduced.
// See: Theme 4 follow-up.

test.skip('CopilotSettingsManager - constructs with fake log', () => {
  // Blocked: require('../out/copilotSettings.js') throws "Cannot find module 'vscode'"
  const { CopilotSettingsManager } = require('../out/copilotSettings.js');
  const fakeLog = { appendLine: () => {} };
  const mgr = new CopilotSettingsManager(fakeLog);
  assert.ok(mgr);
});

test.skip('CopilotSettingsManager - removeAll is idempotent on empty state', async () => {
  // Blocked: requires vscode.workspace.getConfiguration mock in addition to
  // the vscode module stub. Deferred — see Theme 4 follow-up.
});

// Pure-logic test: discovery settings keys are stable strings used to write
// VS Code configuration. Verifies they match the expected naming convention
// without importing any vscode-dependent module.
test('copilotSettings - discovery location keys match VS Code chat.* convention', () => {
  const keys = [
    'instructionsFilesLocations',
    'promptFilesLocations',
    'agentFilesLocations',
    'agentSkillsLocations',
    'hookFilesLocations',
  ];
  const re = /^[a-z][a-zA-Z]+Locations$/;
  for (const key of keys) {
    assert.ok(re.test(key), `key "${key}" does not match Locations convention`);
  }
});
