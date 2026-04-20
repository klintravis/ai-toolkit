const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { requireFresh, withMockedVscode } = require('./helpers/mockVscode');

test('CopilotSettingsManager - constructs with fake log', () => {
  withMockedVscode(() => {
    const { CopilotSettingsManager } = requireFresh('./out/copilotSettings.js');
    const fakeLog = { appendLine: () => {} };
    const mgr = new CopilotSettingsManager(fakeLog);
    assert.ok(mgr);
  });
});

test('CopilotSettingsManager - removeAll is idempotent on empty state', async () => {
  const updates = [];
  await withMockedVscode(async () => {
    const { CopilotSettingsManager } = requireFresh('./out/copilotSettings.js');
    const fakeLog = { appendLine: () => {} };
    const mgr = new CopilotSettingsManager(fakeLog);
    await mgr.removeAll();
  }, {
    workspace: {
      getConfiguration: (section) => ({
        get: (_key, fallback) => fallback,
        update: async (key, value, target) => { updates.push({ section, key, value, target }); },
      }),
    },
  });

  assert.ok(updates.length > 0);
  assert.ok(updates.some(update => update.section === 'aiToolkit' && update.key === 'managedToolkitRoots'));
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

test('CopilotSettingsManager - flat toolkits write one-segment discovery roots', async () => {
  const configState = new Map();
  await withMockedVscode(async () => {
    const { CopilotSettingsManager } = requireFresh('./out/copilotSettings.js');
    const mgr = new CopilotSettingsManager({ appendLine: () => {} });
    const rootPath = path.join(os.homedir(), 'ai-toolkit-flat-test');
    await mgr.applyToolkits([{
      id: '~/ai-toolkit-flat-test',
      name: 'Flat Toolkit',
      rootPath,
      format: 'sideloaded',
      enabled: true,
      assets: [{
        id: 'flat::instructions/reviewer.instructions.md',
        name: 'Reviewer',
        type: 'instructions',
        sourcePath: path.join(rootPath, 'instructions', 'reviewer.instructions.md'),
        relativePath: 'instructions/reviewer.instructions.md',
        isFolder: false,
        platform: 'copilot',
      }],
    }]);
  }, {
    workspace: {
      getConfiguration: (section) => ({
        get: (key, fallback) => configState.get(`${section}.${key}`) ?? fallback,
        update: async (key, value) => { configState.set(`${section}.${key}`, value); },
      }),
    },
  });

  const locations = configState.get('chat.instructionsFilesLocations');
  assert.deepEqual(locations, { '~/ai-toolkit-flat-test/instructions': true });
});

test('CopilotSettingsManager - platformed and legacy toolkits keep two-segment discovery roots', async () => {
  const configState = new Map();
  await withMockedVscode(async () => {
    const { CopilotSettingsManager } = requireFresh('./out/copilotSettings.js');
    const mgr = new CopilotSettingsManager({ appendLine: () => {} });
    const dualRoot = path.join(os.homedir(), 'ai-toolkit-dual-test');
    const legacyRoot = path.join(os.homedir(), 'ai-toolkit-legacy-test');
    await mgr.applyToolkits([
      {
        id: '~/ai-toolkit-dual-test',
        name: 'Dual Toolkit',
        rootPath: dualRoot,
        format: 'dual-platform',
        enabled: true,
        assets: [{
          id: 'dual::claude/skills/review-skill',
          name: 'Review Skill',
          type: 'skills',
          sourcePath: path.join(dualRoot, 'claude', 'skills', 'review-skill'),
          relativePath: 'claude/skills/review-skill',
          isFolder: true,
          platform: 'both',
        }],
      },
      {
        id: '~/ai-toolkit-legacy-test',
        name: 'Legacy Toolkit',
        rootPath: legacyRoot,
        format: 'sideloaded',
        enabled: true,
        assets: [{
          id: 'legacy::.github/agents/reviewer.agent.md',
          name: 'Reviewer',
          type: 'agents',
          sourcePath: path.join(legacyRoot, '.github', 'agents', 'reviewer.agent.md'),
          relativePath: '.github/agents/reviewer.agent.md',
          isFolder: false,
          platform: 'copilot',
        }],
      },
    ]);
  }, {
    workspace: {
      getConfiguration: (section) => ({
        get: (key, fallback) => configState.get(`${section}.${key}`) ?? fallback,
        update: async (key, value) => { configState.set(`${section}.${key}`, value); },
      }),
    },
  });

  assert.deepEqual(configState.get('chat.agentSkillsLocations'), {
    '~/ai-toolkit-dual-test/claude/skills': true,
  });
  assert.deepEqual(configState.get('chat.agentFilesLocations'), {
    '~/ai-toolkit-legacy-test/.github/agents': true,
  });
});
