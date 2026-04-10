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
  return { id: rootPath, name: path.basename(rootPath), rootPath, assets, enabled, format: 'dual-platform' };
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

    // Check package.json created at plugin root
    const pluginJson = path.join(pluginsPath, tkName, 'package.json');
    assert.ok(fs.existsSync(pluginJson), 'package.json should be created at plugin root');
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
