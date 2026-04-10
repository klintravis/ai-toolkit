const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ClaudeSettingsManager } = require('../out/claudeSettings.js');
const { AssetType } = require('../out/types.js');

function makeTempDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeContext(initial = {}) {
  let state = { ...initial };
  return {
    globalState: {
      get: (key) => state[key],
      update: async (key, value) => { state[key] = value; },
    },
    _state: state,
  };
}

function makeLog() {
  const lines = [];
  return { appendLine: (l) => lines.push(l), lines };
}

function makeToolkit(rootPath, assets, enabled = true) {
  // Use tilde-relative id so pluginName() produces path.basename(rootPath) —
  // the same predictable short name that tests already expect.
  const name = path.basename(rootPath);
  const id = `~/${name}`;
  return { id, name, rootPath, assets, enabled, format: 'dual-platform' };
}

function makeAsset(type, platform, name, sourcePath, isFolder = false) {
  return { id: `test::${name}`, name, type, platform, sourcePath, relativePath: name, isFolder };
}

// --- settings.json creation ---

test('applyToolkits - creates settings.json when missing', async () => {
  const tmpDir = makeTempDir('cs-create');
  const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([]);
    assert.ok(fs.existsSync(settingsPath), 'settings.json should be created');
    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.deepEqual(content, {});
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - aborts on malformed JSON, does not overwrite', async () => {
  const tmpDir = makeTempDir('cs-malformed');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    fs.writeFileSync(settingsPath, 'NOT JSON {{{{');
    const log = makeLog();
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, log, () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([]);
    assert.equal(fs.readFileSync(settingsPath, 'utf-8'), 'NOT JSON {{{{', 'Malformed file must not be overwritten');
    assert.ok(log.lines.some(l => l.includes('malformed')), 'Should log malformed error');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- MCPs ---

test('applyToolkits - merges MCP entries into settings.json', async () => {
  const tmpDir = makeTempDir('cs-mcp');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const mcpFile = path.join(tmpDir, 'server.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ name: 'my-server', command: 'node', args: ['./index.js'] }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.McpServer, 'claude', 'my-server', mcpFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const key = `${path.basename(tmpDir)}__my-server`;
    assert.ok(settings.mcpServers?.[key], 'MCP entry should be added');
    assert.equal(settings.mcpServers[key].command, 'node');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - removes managed MCPs when toolkit disabled', async () => {
  const tmpDir = makeTempDir('cs-mcp-remove');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const mcpFile = path.join(tmpDir, 'server.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ name: 'my-server', command: 'node', args: [] }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.McpServer, 'claude', 'my-server', mcpFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);

    // Enable — add MCP
    await mgr.applyToolkits([toolkit]);
    let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const key = `${path.basename(tmpDir)}__my-server`;
    assert.ok(settings.mcpServers?.[key]);

    // Disable — remove MCP
    toolkit.enabled = false;
    await mgr.applyToolkits([toolkit]);
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(!settings.mcpServers?.[key], 'MCP should be removed when toolkit disabled');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - does not remove user-defined MCPs', async () => {
  const tmpDir = makeTempDir('cs-mcp-user');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: { 'user-server': { command: 'node', args: [] } } }));
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(settings.mcpServers?.['user-server'], 'User-defined MCP must not be removed');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- Hooks ---

test('applyToolkits - merges hook entries into settings.json', async () => {
  const tmpDir = makeTempDir('cs-hook');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const hookFile = path.join(tmpDir, 'lint.json');
    const hookScript = path.join(tmpDir, 'lint.sh');
    fs.writeFileSync(hookScript, '#!/bin/sh');
    fs.writeFileSync(hookFile, JSON.stringify({ event: 'PreToolUse', matcher: 'Bash', command: hookScript }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Hook, 'claude', 'lint', hookFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(settings.hooks?.PreToolUse, 'PreToolUse hook group should be added');
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - removes managed hooks when toolkit disabled', async () => {
  const tmpDir = makeTempDir('cs-hook-remove');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const hookFile = path.join(tmpDir, 'lint.json');
    const hookScript = path.join(tmpDir, 'lint.sh');
    fs.writeFileSync(hookScript, '#!/bin/sh');
    fs.writeFileSync(hookFile, JSON.stringify({ event: 'PreToolUse', command: hookScript }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Hook, 'claude', 'lint', hookFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);

    await mgr.applyToolkits([toolkit]);
    toolkit.enabled = false;
    await mgr.applyToolkits([toolkit]);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = settings.hooks?.PreToolUse ?? [];
    const hasManagedHook = hooks.some(h => h.hooks?.[0]?.command === hookScript);
    assert.ok(!hasManagedHook, 'Managed hook should be removed when toolkit disabled');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- Skill symlinks ---

test('applyToolkits - symlinks skill folder into claude plugins dir', async () => {
  const tmpDir = makeTempDir('cs-skill');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Skill, 'both', 'my-skill', skillDir, true)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);
    const tkName = path.basename(tmpDir);
    const expectedLink = path.join(pluginsPath, tkName, 'skills', 'my-skill');
    assert.ok(fs.existsSync(expectedLink), 'Skill should be linked into plugins dir');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - symlinks native hooks/ and agents/ dirs for sideloaded plugins', async () => {
  const tmpDir = makeTempDir('cs-native-dirs');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    // Simulate a sideloaded plugin with native hooks/ and agents/ directories
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');

    const hooksDir = path.join(tmpDir, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [] } }));

    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'helper.md'), '# agent');

    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Skill, 'claude', 'my-skill', skillDir, true)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);

    const tkName = path.basename(tmpDir);
    const pluginDir = path.join(pluginsPath, tkName);
    assert.ok(fs.existsSync(path.join(pluginDir, 'hooks')), 'hooks/ should be linked into plugin dir');
    assert.ok(fs.existsSync(path.join(pluginDir, 'agents')), 'agents/ should be linked into plugin dir');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- Relative path resolution ---

test('applyToolkits - resolves relative args in MCP entry', async () => {
  const tmpDir = makeTempDir('cs-mcp-relpath');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const mcpFile = path.join(tmpDir, 'server.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ name: 'srv', command: 'node', args: ['./index.js'] }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.McpServer, 'claude', 'srv', mcpFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const key = `${path.basename(tmpDir)}__srv`;
    const args = settings.mcpServers?.[key]?.args ?? [];
    assert.ok(path.isAbsolute(args[0]), 'Relative args should be resolved to absolute paths');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- Plugin registration ---

test('applyToolkits - registers plugin in installed_plugins.json and enabledPlugins', async () => {
  const tmpDir = makeTempDir('cs-plugin-reg');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Skill, 'both', 'my-skill', skillDir, true)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);

    // Check installed_plugins.json
    const installedPath = path.join(registryPath, 'installed_plugins.json');
    assert.ok(fs.existsSync(installedPath), 'installed_plugins.json should be created');
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
    const tkName = path.basename(tmpDir);
    const pluginKey = `${tkName}@ai-toolkit`;
    assert.ok(installed.plugins?.[pluginKey], 'Plugin should be registered');
    assert.equal(installed.plugins[pluginKey][0].scope, 'user');

    // Check enabledPlugins in settings.json
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(settings.enabledPlugins?.[pluginKey], 'Plugin should be enabled in settings');

    // Check .claude-plugin/plugin.json created at plugin root
    const pluginJson = path.join(pluginsPath, tkName, '.claude-plugin', 'plugin.json');
    assert.ok(fs.existsSync(pluginJson), '.claude-plugin/plugin.json should be created at plugin root');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - removes plugin registration when toolkit disabled', async () => {
  const tmpDir = makeTempDir('cs-plugin-remove');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Skill, 'both', 'my-skill', skillDir, true)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);

    // Enable
    await mgr.applyToolkits([toolkit]);
    const tkName = path.basename(tmpDir);
    const pluginKey = `${tkName}@ai-toolkit`;

    // Disable
    toolkit.enabled = false;
    await mgr.applyToolkits([toolkit]);

    const installed = JSON.parse(fs.readFileSync(path.join(registryPath, 'installed_plugins.json'), 'utf-8'));
    assert.ok(!installed.plugins?.[pluginKey], 'Plugin should be removed from installed_plugins.json');

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(!settings.enabledPlugins?.[pluginKey], 'Plugin should be removed from enabledPlugins');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - does not remove user-defined enabledPlugins entries', async () => {
  const tmpDir = makeTempDir('cs-plugin-user-enabled');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    // Pre-populate settings.json with a user-defined enabledPlugins entry
    fs.writeFileSync(settingsPath, JSON.stringify({
      enabledPlugins: { 'user-plugin@some-marketplace': true }
    }));
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(settings.enabledPlugins?.['user-plugin@some-marketplace'], 'User-defined enabledPlugins must not be removed');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- Collision resistance ---

test('applyToolkits - two toolkits with same folder name in different parents get distinct plugin dirs', async () => {
  const base = path.join(os.tmpdir(), `cs-collision-${Date.now()}`);
  const dirA = path.join(base, 'workA', 'my-toolkit');
  const dirB = path.join(base, 'workB', 'my-toolkit');
  fs.mkdirSync(path.join(dirA, 'skills', 'skill-a'), { recursive: true });
  fs.writeFileSync(path.join(dirA, 'skills', 'skill-a', 'SKILL.md'), '# a');
  fs.mkdirSync(path.join(dirB, 'skills', 'skill-b'), { recursive: true });
  fs.writeFileSync(path.join(dirB, 'skills', 'skill-b', 'SKILL.md'), '# b');
  const settingsPath = path.join(base, 'settings.json');
  const pluginsPath = path.join(base, 'plugins');
  const registryPath = path.join(base, 'registry');
  try {
    const skillA = makeAsset(AssetType.Skill, 'claude', 'skill-a', path.join(dirA, 'skills', 'skill-a'), true);
    const skillB = makeAsset(AssetType.Skill, 'claude', 'skill-b', path.join(dirB, 'skills', 'skill-b'), true);
    // Use absolute paths as IDs (simulates non-tilde paths in tests)
    const tkA = { id: dirA, name: 'my-toolkit', rootPath: dirA, assets: [skillA], enabled: true, format: 'dual-platform' };
    const tkB = { id: dirB, name: 'my-toolkit', rootPath: dirB, assets: [skillB], enabled: true, format: 'dual-platform' };
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([tkA, tkB]);
    const pluginDirs = fs.readdirSync(pluginsPath).filter(d => !d.startsWith('.'));
    assert.equal(pluginDirs.length, 2, 'each toolkit must get its own plugin directory');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// --- Idempotency ---

test('applyToolkits - applying twice is idempotent (EEXIST handled, paths tracked correctly)', async () => {
  const tmpDir = makeTempDir('cs-idempotent');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Skill, 'claude', 'my-skill', skillDir, true)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);

    await mgr.applyToolkits([toolkit]);
    await mgr.applyToolkits([toolkit]); // second apply — must not throw

    // Find the actual plugin dir (name is derived from full id, not just basename in tests)
    const pluginDirs = fs.readdirSync(pluginsPath).filter(d => !d.startsWith('.'));
    assert.equal(pluginDirs.length, 1, 'should have exactly one plugin dir');
    const pluginDir = path.join(pluginsPath, pluginDirs[0]);
    assert.ok(fs.existsSync(path.join(pluginDir, 'skills', 'my-skill')), 'skill link must still exist after second apply');

    // Disabling after double-apply must clean up cleanly
    toolkit.enabled = false;
    await mgr.applyToolkits([toolkit]);
    const remainingDirs = fs.existsSync(pluginsPath)
      ? fs.readdirSync(pluginsPath).filter(d => !d.startsWith('.'))
      : [];
    assert.equal(remainingDirs.length, 0, 'plugin dir should be removed after disable');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- Corrupt registry resilience ---

test('applyToolkits - corrupt installed_plugins.json does not throw', async () => {
  const tmpDir = makeTempDir('cs-corrupt-reg');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    fs.mkdirSync(registryPath, { recursive: true });
    fs.writeFileSync(path.join(registryPath, 'installed_plugins.json'), 'CORRUPT {{{{');
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Skill, 'claude', 'my-skill', skillDir, true)]);
    const ctx = makeContext();
    const log = makeLog();
    const mgr = new ClaudeSettingsManager(ctx, log, () => settingsPath, () => pluginsPath, () => registryPath);
    // Should not throw; logs an error and continues
    await assert.doesNotReject(() => mgr.applyToolkits([toolkit]));
    assert.ok(log.lines.some(l => l.includes('installed_plugins')), 'Should log the registry read error');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// --- Security ---

test('applyToolkits - hook command outside toolkit root is rejected', async () => {
  const tmpDir = makeTempDir('cs-hook-escape');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const hookFile = path.join(tmpDir, 'escape.json');
    // Absolute path that escapes the toolkit root
    fs.writeFileSync(hookFile, JSON.stringify({ event: 'PreToolUse', command: process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/usr/bin/env' }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Hook, 'claude', 'escape', hookFile)]);
    const ctx = makeContext();
    const log = makeLog();
    const mgr = new ClaudeSettingsManager(ctx, log, () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = settings.hooks?.PreToolUse ?? [];
    assert.equal(hooks.length, 0, 'Hook with escaped command must not be written to settings');
    assert.ok(log.lines.some(l => l.includes('outside toolkit root')), 'Must log rejection reason');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('applyToolkits - hook with missing command field is skipped silently', async () => {
  const tmpDir = makeTempDir('cs-hook-no-cmd');
  const settingsPath = path.join(tmpDir, 'settings.json');
  const pluginsPath = path.join(tmpDir, 'plugins');
  const registryPath = path.join(tmpDir, 'registry');
  try {
    const hookFile = path.join(tmpDir, 'no-cmd.json');
    fs.writeFileSync(hookFile, JSON.stringify({ event: 'PreToolUse' })); // no command field
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Hook, 'claude', 'no-cmd', hookFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath, () => registryPath);
    await mgr.applyToolkits([toolkit]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(!settings.hooks, 'No hook should be added when command field is absent');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});
