const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ToolkitScanner, DEFAULT_ASSET_MAPPINGS } = require('../out/scanner.js');
const { SourceFormat, AssetType } = require('../out/types.js');
const { toHomeRelativePath } = require('../out/pathUtils.js');

function expectedToolkitId(rootPath) {
  const tildeRelative = toHomeRelativePath(rootPath);
  return tildeRelative ?? path.resolve(rootPath).replace(/\\/g, '/');
}

function makeTempDir(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

// --- Edge cases ---

test('scanPath - nonexistent path returns empty array', async () => {
  const scanner = new ToolkitScanner();
  assert.deepEqual(await scanner.scanPath(makeTempDir('nonexistent'), {}), []);
});

test('scanPath - empty dir returns empty array', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('empty');
  try {
    fs.mkdirSync(dir, { recursive: true });
    assert.deepEqual(await scanner.scanPath(dir, {}), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - old .github/ format returns empty array (retired format)', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('old-github');
  try {
    fs.mkdirSync(path.join(dir, '.github', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'agents', 'test.agent.md'), '# test');
    assert.deepEqual(await scanner.scanPath(dir, {}), [], 'Old .github format should not be detected');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- DualPlatform detection ---

test('scanPath - detects DualPlatform via copilot/ subfolder', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('dual-copilot');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'test.agent.md'), '# test');
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].format, SourceFormat.DualPlatform);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - detects DualPlatform via claude/ subfolder', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('dual-claude');
  try {
    fs.mkdirSync(path.join(dir, 'claude', 'skills', 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude', 'skills', 'my-skill', 'SKILL.md'), '# skill');
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].format, SourceFormat.DualPlatform);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Asset platform assignment ---

test('scanPath - copilot/agents asset has platform copilot', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('plat-copilot');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'test.agent.md'), '# test');
    const result = await scanner.scanPath(dir, {});
    const agents = result[0].assets.filter(a => a.type === AssetType.Agent);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].platform, 'copilot');
    assert.equal(agents[0].isFolder, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - claude/skills asset has platform both', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('plat-both');
  try {
    fs.mkdirSync(path.join(dir, 'claude', 'skills', 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude', 'skills', 'my-skill', 'SKILL.md'), '# skill');
    const result = await scanner.scanPath(dir, {});
    const skills = result[0].assets.filter(a => a.type === AssetType.Skill);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].platform, 'both');
    assert.equal(skills[0].isFolder, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - claude/hooks asset has platform claude', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('plat-claude-hook');
  try {
    fs.mkdirSync(path.join(dir, 'claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude', 'hooks', 'lint.json'), '{"event":"PreToolUse","command":"./lint.sh"}');
    const result = await scanner.scanPath(dir, {});
    const hooks = result[0].assets.filter(a => a.type === AssetType.Hook && a.platform === 'claude');
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].platform, 'claude');
    assert.equal(hooks[0].isFolder, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - claude/mcps asset has platform claude', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('plat-mcp');
  try {
    fs.mkdirSync(path.join(dir, 'claude', 'mcps'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude', 'mcps', 'server.json'), '{"name":"srv","command":"node","args":["./index.js"]}');
    const result = await scanner.scanPath(dir, {});
    const mcps = result[0].assets.filter(a => a.type === AssetType.McpServer);
    assert.equal(mcps.length, 1);
    assert.equal(mcps[0].platform, 'claude');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - shared/standards asset has platform shared and isFolder true', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('plat-shared');
  try {
    fs.mkdirSync(path.join(dir, 'shared', 'standards', 'ts-style'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'shared', 'standards', 'ts-style', 'rules.md'), '# rules');
    const result = await scanner.scanPath(dir, {});
    const standards = result[0].assets.filter(a => a.type === AssetType.Standard);
    assert.equal(standards.length, 1);
    assert.equal(standards[0].platform, 'shared');
    assert.equal(standards[0].isFolder, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Full toolkit with mixed assets ---

test('scanPath - full DualPlatform toolkit discovers all asset types', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('dual-full');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'copilot', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'claude', 'skills', 'my-skill'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'claude', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'claude', 'mcps'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'shared', 'standards', 'style'), { recursive: true });

    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'test.agent.md'), '# agent');
    fs.writeFileSync(path.join(dir, 'copilot', 'instructions', 'style.instructions.md'), '# instruct');
    fs.writeFileSync(path.join(dir, 'claude', 'skills', 'my-skill', 'SKILL.md'), '# skill');
    fs.writeFileSync(path.join(dir, 'claude', 'hooks', 'lint.json'), '{"event":"PreToolUse","command":"./lint.sh"}');
    fs.writeFileSync(path.join(dir, 'claude', 'mcps', 'srv.json'), '{"name":"srv","command":"node","args":[]}');
    fs.writeFileSync(path.join(dir, 'shared', 'standards', 'style', 'rules.md'), '# rules');

    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1);
    const tk = result[0];
    const byType = (type) => tk.assets.filter(a => a.type === type);
    assert.equal(byType(AssetType.Agent).length, 1);
    assert.equal(byType(AssetType.Instruction).length, 1);
    assert.equal(byType(AssetType.Skill).length, 1);
    assert.equal(byType(AssetType.Hook).filter(a => a.platform === 'claude').length, 1);
    assert.equal(byType(AssetType.McpServer).length, 1);
    assert.equal(byType(AssetType.Standard).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- ai-toolkit.json manifest ---

test('scanPath - ai-toolkit.json custom mapping is additive', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('manifest-custom');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'custom', 'linters'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'a.agent.md'), '# a');
    fs.writeFileSync(path.join(dir, 'custom', 'linters', 'eslint.json'), '{}');
    fs.writeFileSync(path.join(dir, 'ai-toolkit.json'), JSON.stringify({
      mappings: [{ folder: 'custom/linters', assetType: 'standards', platform: 'shared', isFolder: false, extensions: ['.json'] }]
    }));
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1);
    const custom = result[0].assets.filter(a => a.type === 'standards');
    assert.equal(custom.length, 1);
    assert.equal(custom[0].name, 'Eslint');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - ai-toolkit.json name overrides directory name', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('manifest-name');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'a.agent.md'), '# a');
    fs.writeFileSync(path.join(dir, 'ai-toolkit.json'), JSON.stringify({ name: 'My Custom Toolkit' }));
    const result = await scanner.scanPath(dir, {});
    assert.equal(result[0].name, 'My Custom Toolkit');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - invalid ai-toolkit.json entries are skipped gracefully', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('manifest-bad');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'a.agent.md'), '# a');
    fs.writeFileSync(path.join(dir, 'ai-toolkit.json'), JSON.stringify({
      mappings: [{ folder: 123, assetType: null, platform: 'bad-value' }]
    }));
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1, 'Bad manifest should not prevent toolkit discovery');
    assert.equal(result[0].assets.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Multiple toolkits in subdirs ---

test('scanPath - discovers multiple DualPlatform toolkits in subdirectories', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('multi-dual');
  try {
    fs.mkdirSync(path.join(dir, 'kit-one', 'copilot', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'kit-two', 'claude', 'skills', 'skill-a'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'kit-one', 'copilot', 'agents', 'a.agent.md'), '# a');
    fs.writeFileSync(path.join(dir, 'kit-two', 'claude', 'skills', 'skill-a', 'SKILL.md'), '# s');
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 2);
    assert.ok(result.some(t => t.name === 'kit-one'));
    assert.ok(result.some(t => t.name === 'kit-two'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- File filtering ---

test('scanPath - copilot/agents rejects non-.agent.md files', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('ext-filter');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'good.agent.md'), '# ok');
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'bad.md'), '# bad');
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'bad.txt'), 'nope');
    const result = await scanner.scanPath(dir, {});
    const agents = result[0].assets.filter(a => a.type === AssetType.Agent);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, 'Good');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - excludes README.md and other excluded filenames', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('excluded');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'workflows', 'deploy.md'), '# deploy');
    fs.writeFileSync(path.join(dir, 'copilot', 'workflows', 'README.md'), '# readme');
    const result = await scanner.scanPath(dir, {});
    const workflows = result[0].assets.filter(a => a.type === AssetType.Workflow);
    assert.equal(workflows.length, 1);
    assert.equal(workflows[0].name, 'Deploy');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - hidden files and directories are skipped', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('hidden');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'visible.agent.md'), '# v');
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', '.hidden.agent.md'), '# h');
    const result = await scanner.scanPath(dir, {});
    assert.equal(result[0].assets.length, 1);
    assert.equal(result[0].assets[0].name, 'Visible');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Nested file-based assets ---

test('scanPath - nested copilot/instructions/ assets are discovered recursively', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('nested');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'instructions', 'security'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'instructions', 'general.instructions.md'), '# g');
    fs.writeFileSync(path.join(dir, 'copilot', 'instructions', 'security', 'auth.instructions.md'), '# a');
    const result = await scanner.scanPath(dir, {});
    const instructions = result[0].assets.filter(a => a.type === AssetType.Instruction);
    assert.equal(instructions.length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Folder asset children ---

test('scanPath - folder assets expose children', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('folder-children');
  try {
    fs.mkdirSync(path.join(dir, 'claude', 'skills', 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude', 'skills', 'my-skill', 'SKILL.md'), '# s');
    fs.writeFileSync(path.join(dir, 'claude', 'skills', 'my-skill', 'helper.sh'), '#!/bin/sh');
    const result = await scanner.scanPath(dir, {});
    const skill = result[0].assets.find(a => a.isFolder);
    assert.ok(skill);
    assert.ok(Array.isArray(skill.children));
    assert.ok(skill.children.length >= 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Enabled state ---

test('scanPath - enabled toolkit is marked correctly', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('enabled');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'a.agent.md'), '# a');
    const id = expectedToolkitId(dir);
    const result = await scanner.scanPath(dir, { [id]: true });
    assert.equal(result[0].enabled, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Name formatting ---

test('scanPath - formats names from kebab-case and snake_case', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('names');
  try {
    fs.mkdirSync(path.join(dir, 'copilot', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'my-cool-agent.agent.md'), '# a');
    fs.writeFileSync(path.join(dir, 'copilot', 'agents', 'another_one.agent.md'), '# b');
    const result = await scanner.scanPath(dir, {});
    const names = result[0].assets.map(a => a.name).sort();
    assert.deepEqual(names, ['Another One', 'My Cool Agent']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- Symlink handling ---

test('scanPath - follows file symlinks in asset folders', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('sym-file');
  try {
    const src = path.join(dir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'original.agent.md'), '# orig');
    const picksAgents = path.join(dir, 'picks', 'copilot', 'agents');
    fs.mkdirSync(picksAgents, { recursive: true });
    const linkTarget = path.join(picksAgents, 'linked.agent.md');
    try {
      fs.symlinkSync(path.join(src, 'original.agent.md'), linkTarget, 'file');
    } catch {
      fs.copyFileSync(path.join(src, 'original.agent.md'), linkTarget);
    }
    const result = await scanner.scanPath(path.join(dir, 'picks'), {});
    assert.equal(result.length, 1);
    assert.equal(result[0].assets.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - directory symlinks escaping toolkit root are rejected', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('sym-escape');
  const outside = makeTempDir('sym-outside');
  try {
    const externalSkill = path.join(outside, 'evil-skill');
    fs.mkdirSync(externalSkill, { recursive: true });
    fs.writeFileSync(path.join(externalSkill, 'SKILL.md'), '# evil');
    fs.mkdirSync(path.join(dir, 'claude', 'skills'), { recursive: true });
    try {
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(externalSkill, path.join(dir, 'claude', 'skills', 'evil-skill'), type);
    } catch {
      // eslint-disable-next-line no-console
      console.log('[skip] symlink escape test: symlink creation requires elevated privileges on this platform');
      return;
    }
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 0, 'Escaped symlink should produce no assets');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// --- Sideload (standalone skill folder) ---

test('scanPath - sideloads a plain skill folder with no DualPlatform structure', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('sideload');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# The Sauce');
    fs.writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh');
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1, 'should produce one synthetic toolkit');
    const tk = result[0];
    assert.equal(tk.name, path.basename(dir));
    assert.equal(tk.rootPath, dir);
    assert.equal(tk.format, SourceFormat.Sideloaded);
    assert.equal(tk.assets.length, 1);
    const asset = tk.assets[0];
    assert.equal(asset.type, AssetType.Skill);
    assert.equal(asset.platform, 'claude');
    assert.equal(asset.isFolder, true);
    assert.equal(asset.sourcePath, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - sideloaded skill exposes children', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('sideload-children');
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# skill');
    fs.writeFileSync(path.join(dir, 'src', 'main.js'), 'module.exports = {}');
    const result = await scanner.scanPath(dir, {});
    const asset = result[0]?.assets[0];
    assert.ok(asset?.children && asset.children.length > 0, 'children should be scanned');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - empty folder does not sideload', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('sideload-empty');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const result = await scanner.scanPath(dir, {});
    assert.deepEqual(result, [], 'empty folder should not produce a sideloaded toolkit');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - sideloads individual skills from skills/ subdirectory', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('sideload-skills-subdir');
  try {
    fs.mkdirSync(path.join(dir, 'skills', 'brainstorming'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', 'brainstorming', 'SKILL.md'), '# Brainstorming');
    fs.mkdirSync(path.join(dir, 'skills', 'writing-plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', 'writing-plans', 'SKILL.md'), '# Writing Plans');
    fs.writeFileSync(path.join(dir, 'README.md'), '# toolkit');

    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1, 'should produce one synthetic toolkit');
    const tk = result[0];
    assert.equal(tk.assets.length, 2, 'one asset per skill directory');
    const names = tk.assets.map(a => a.name).sort();
    assert.deepEqual(names, ['Brainstorming', 'Writing Plans']);
    for (const asset of tk.assets) {
      assert.equal(asset.type, AssetType.Skill);
      assert.equal(asset.platform, 'claude');
      assert.equal(asset.isFolder, true);
      // sourcePath must point to the individual skill dir, not the toolkit root
      assert.ok(asset.sourcePath.endsWith('brainstorming') || asset.sourcePath.endsWith('writing-plans'));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanPath - sideload with empty skills/ subdirectory falls back to whole-folder skill', async () => {
  const scanner = new ToolkitScanner();
  const dir = makeTempDir('sideload-empty-skills');
  try {
    fs.mkdirSync(path.join(dir, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# root skill');
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].assets.length, 1);
    assert.equal(result[0].assets[0].sourcePath, dir, 'falls back to whole-folder skill');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- DEFAULT_ASSET_MAPPINGS export ---

test('DEFAULT_ASSET_MAPPINGS is exported and has expected entries', () => {
  assert.ok(Array.isArray(DEFAULT_ASSET_MAPPINGS));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'claude/skills' && m.platform === 'both'));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'copilot/agents' && m.platform === 'copilot'));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'claude/mcps' && m.platform === 'claude'));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'shared/standards' && m.platform === 'shared'));
});
