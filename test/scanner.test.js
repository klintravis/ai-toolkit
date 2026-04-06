const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ToolkitScanner } = require('../out/scanner.js');
const { SourceFormat, AssetType } = require('../out/types.js');
const { toHomeRelativePath } = require('../out/pathUtils.js');

/**
 * Unit tests for ToolkitScanner.
 * Tests asset discovery across source formats, asset types, and edge cases.
 */

/** Compute the expected toolkit ID for a path (mirrors scanner logic). */
function expectedToolkitId(rootPath) {
  const tildeRelative = toHomeRelativePath(rootPath);
  if (tildeRelative) { return tildeRelative; }
  return path.resolve(rootPath).replace(/\\/g, '/');
}

/** Create a temp directory with a unique name. */
function makeTempDir(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

// --- Basic edge cases ---

test('scanPath - nonexistent path returns empty array', async () => {
  const scanner = new ToolkitScanner();
  const result = await scanner.scanPath(makeTempDir('nonexistent'), {});
  assert.deepEqual(result, []);
});

test('scanPath - empty .github directory returns no toolkits', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-empty');

  try {
    fs.mkdirSync(path.join(tempDir, '.github'), { recursive: true });

    const result = await scanner.scanPath(tempDir, {});
    assert.deepEqual(result, [], 'Empty .github should return no toolkits');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- CopilotCustomizer format ---

test('scanPath - CopilotCustomizer format discovers all asset types', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-copilot-customizer');

  try {
    const gh = path.join(tempDir, '.github');

    // File-based asset folders
    fs.mkdirSync(path.join(gh, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(gh, 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(gh, 'prompts'), { recursive: true });
    fs.mkdirSync(path.join(gh, 'workflows'), { recursive: true });

    // Folder-based asset folders
    fs.mkdirSync(path.join(gh, 'skills', 'test-skill'), { recursive: true });
    fs.mkdirSync(path.join(gh, 'plugins', 'test-plugin'), { recursive: true });
    fs.mkdirSync(path.join(gh, 'hooks', 'test-hook'), { recursive: true });
    fs.mkdirSync(path.join(gh, 'standards', 'test-standard'), { recursive: true });

    // File-based asset content
    fs.writeFileSync(path.join(gh, 'agents', 'test-agent.agent.md'), '# Test Agent');
    fs.writeFileSync(path.join(gh, 'instructions', 'coding.instructions.md'), '# Coding');
    fs.writeFileSync(path.join(gh, 'prompts', 'review.prompt.md'), '# Review');
    fs.writeFileSync(path.join(gh, 'workflows', 'deploy.md'), '# Deploy');

    // Folder-based asset content (files inside the folder)
    fs.writeFileSync(path.join(gh, 'skills', 'test-skill', 'SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(gh, 'plugins', 'test-plugin', 'plugin.json'), '{}');
    fs.writeFileSync(path.join(gh, 'hooks', 'test-hook', 'hook.md'), '# Hook');
    fs.writeFileSync(path.join(gh, 'standards', 'test-standard', 'rule.md'), '# Rule');

    const result = await scanner.scanPath(tempDir, {});

    assert.equal(result.length, 1);
    const toolkit = result[0];
    assert.equal(toolkit.format, SourceFormat.CopilotCustomizer);
    assert.equal(toolkit.rootPath, tempDir);
    assert.equal(toolkit.enabled, false);

    const byType = (type) => toolkit.assets.filter(a => a.type === type);

    assert.equal(byType(AssetType.Agent).length, 1, 'Should discover 1 agent');
    assert.equal(byType(AssetType.Instruction).length, 1, 'Should discover 1 instruction');
    assert.equal(byType(AssetType.Prompt).length, 1, 'Should discover 1 prompt');
    assert.equal(byType(AssetType.Workflow).length, 1, 'Should discover 1 workflow');
    assert.equal(byType(AssetType.Skill).length, 1, 'Should discover 1 skill');
    assert.equal(byType(AssetType.Plugin).length, 1, 'Should discover 1 plugin');
    assert.equal(byType(AssetType.Hook).length, 1, 'Should discover 1 hook');
    assert.equal(byType(AssetType.Standard).length, 1, 'Should discover 1 standard');
    assert.equal(toolkit.assets.length, 8, 'Should discover exactly 8 assets');

    // Verify file vs folder classification
    assert.equal(byType(AssetType.Agent)[0].isFolder, false);
    assert.equal(byType(AssetType.Skill)[0].isFolder, true);

    // Verify name formatting
    assert.equal(byType(AssetType.Agent)[0].name, 'Test Agent');
    assert.equal(byType(AssetType.Skill)[0].name, 'Test Skill');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- AwesomeCopilot format ---

test('scanPath - AwesomeCopilot format with top-level asset folders', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-awesome-copilot');

  try {
    // Top-level asset folders (no .github/)
    fs.mkdirSync(path.join(tempDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'skills', 'my-skill'), { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'agents', 'helper.agent.md'), '# Helper');
    fs.writeFileSync(path.join(tempDir, 'instructions', 'style.instructions.md'), '# Style');
    fs.writeFileSync(path.join(tempDir, 'skills', 'my-skill', 'SKILL.md'), '# My Skill');

    const result = await scanner.scanPath(tempDir, {});

    assert.equal(result.length, 1);
    const toolkit = result[0];
    assert.equal(toolkit.format, SourceFormat.AwesomeCopilot);
    assert.equal(toolkit.assets.length, 3);

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Enabled state & ID generation ---

test('scanPath - enabled toolkit is marked correctly via tilde-relative ID', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-enabled');

  try {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'test.agent.md'), '# Test');

    const id = expectedToolkitId(tempDir);
    const result = await scanner.scanPath(tempDir, { [id]: true });

    assert.equal(result.length, 1);
    assert.equal(result[0].enabled, true, 'Toolkit should be marked as enabled');
    assert.equal(result[0].id, id, 'Toolkit ID should match expected format');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Multiple toolkits ---

test('scanPath - handles multiple toolkits in subdirectories', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-multi');

  try {
    const github1 = path.join(tempDir, 'toolkit-one', '.github', 'agents');
    const github2 = path.join(tempDir, 'toolkit-two', '.github', 'prompts');

    fs.mkdirSync(github1, { recursive: true });
    fs.writeFileSync(path.join(github1, 'agent1.agent.md'), '# Agent 1');

    fs.mkdirSync(github2, { recursive: true });
    fs.writeFileSync(path.join(github2, 'prompt2.prompt.md'), '# Prompt 2');

    const result = await scanner.scanPath(tempDir, {});

    assert.equal(result.length, 2, 'Should discover 2 toolkits');
    assert.ok(result.some(t => t.name === 'toolkit-one'), 'Should find toolkit-one');
    assert.ok(result.some(t => t.name === 'toolkit-two'), 'Should find toolkit-two');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- File matching ---

test('scanPath - rejects files with wrong extensions', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-extensions');

  try {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });

    fs.writeFileSync(path.join(agentsDir, 'good.agent.md'), '# Good');
    // These should be excluded: wrong extension for agents/ folder
    fs.writeFileSync(path.join(agentsDir, 'bad.txt'), 'not an agent');
    fs.writeFileSync(path.join(agentsDir, 'bad.md'), 'wrong suffix');
    fs.writeFileSync(path.join(agentsDir, 'bad.json'), '{}');

    const result = await scanner.scanPath(tempDir, {});

    assert.equal(result.length, 1);
    const agents = result[0].assets.filter(a => a.type === AssetType.Agent);
    assert.equal(agents.length, 1, 'Should only discover the valid .agent.md file');
    assert.equal(agents[0].name, 'Good');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('scanPath - excludes common non-asset files like README.md', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-excluded');

  try {
    const workflowsDir = path.join(tempDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    fs.writeFileSync(path.join(workflowsDir, 'deploy.md'), '# Deploy');
    fs.writeFileSync(path.join(workflowsDir, 'README.md'), '# Readme');
    fs.writeFileSync(path.join(workflowsDir, 'CHANGELOG.md'), '# Changes');
    fs.writeFileSync(path.join(workflowsDir, 'LICENSE.md'), '# License');

    const result = await scanner.scanPath(tempDir, {});

    assert.equal(result.length, 1);
    const workflows = result[0].assets.filter(a => a.type === AssetType.Workflow);
    assert.equal(workflows.length, 1, 'Should only discover deploy.md, not README/CHANGELOG/LICENSE');
    assert.equal(workflows[0].name, 'Deploy');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Nested assets ---

test('scanPath - discovers nested file-based assets in subdirectories', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-nested');

  try {
    const instructionsDir = path.join(tempDir, '.github', 'instructions');
    const categoryDir = path.join(instructionsDir, 'security');
    fs.mkdirSync(categoryDir, { recursive: true });

    fs.writeFileSync(path.join(instructionsDir, 'general.instructions.md'), '# General');
    fs.writeFileSync(path.join(categoryDir, 'auth.instructions.md'), '# Auth');

    const result = await scanner.scanPath(tempDir, {});

    assert.equal(result.length, 1);
    const instructions = result[0].assets.filter(a => a.type === AssetType.Instruction);
    assert.equal(instructions.length, 2, 'Should find both top-level and nested instructions');

    const nested = instructions.find(a => a.relativePath.includes('security'));
    assert.ok(nested, 'Should find the nested instruction');
    assert.equal(nested.name, 'Auth');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Name formatting ---

test('scanPath - formats asset names from kebab-case and snake_case', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-names');

  try {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });

    fs.writeFileSync(path.join(agentsDir, 'my-cool-agent.agent.md'), '# Agent');
    fs.writeFileSync(path.join(agentsDir, 'another_agent.agent.md'), '# Agent');

    const result = await scanner.scanPath(tempDir, {});
    const agents = result[0].assets.filter(a => a.type === AssetType.Agent);
    const names = agents.map(a => a.name).sort();
    assert.deepEqual(names, ['Another Agent', 'My Cool Agent']);

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Hidden files ---

test('scanPath - skips hidden files and directories in asset folders', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-hidden');

  try {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });

    fs.writeFileSync(path.join(agentsDir, 'visible.agent.md'), '# Visible');
    fs.writeFileSync(path.join(agentsDir, '.hidden.agent.md'), '# Hidden');

    const result = await scanner.scanPath(tempDir, {});
    const agents = result[0].assets.filter(a => a.type === AssetType.Agent);

    assert.equal(agents.length, 1, 'Should skip hidden files');
    assert.equal(agents[0].name, 'Visible');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Empty asset folders ---

test('scanPath - asset folder with no matching files returns no toolkit', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-empty-assets');

  try {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });

    // Only a non-matching file present
    fs.writeFileSync(path.join(agentsDir, 'notes.txt'), 'not an agent');

    const result = await scanner.scanPath(tempDir, {});
    assert.equal(result.length, 0, 'Should not create a toolkit with zero matched assets');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Hybrid: top-level + .github/ merging ---

test('scanPath - hybrid repo (top-level + .github/) merges assets from both roots', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-hybrid');

  try {
    // Top-level awesome-copilot style
    fs.mkdirSync(path.join(tempDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'agents', 'top-agent.agent.md'), '# top');

    // .github also has some assets (like awesome-copilot does for CI configs)
    const gh = path.join(tempDir, '.github');
    fs.mkdirSync(path.join(gh, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(gh, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(gh, 'agents', 'gh-agent.agent.md'), '# gh');
    fs.writeFileSync(path.join(gh, 'workflows', 'deploy.md'), '# deploy');

    const result = await scanner.scanPath(tempDir, {});
    assert.equal(result.length, 1);
    const tk = result[0];
    assert.equal(tk.format, SourceFormat.AwesomeCopilot);

    const agents = tk.assets.filter(a => a.type === AssetType.Agent);
    const workflows = tk.assets.filter(a => a.type === AssetType.Workflow);
    assert.equal(agents.length, 2, 'Should merge agents from both roots');
    assert.equal(workflows.length, 1, 'Should include .github/workflows content');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Symlink/junction handling (simulates picks dir) ---

test('scanPath - follows file symlinks when scanning asset folders', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-symlink-file');

  try {
    // Real asset files in one folder
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'original.agent.md'), '# original');

    // Fake picks dir with a symlink (or copy fallback) into an agents/ folder
    const picksAgents = path.join(tempDir, 'picks', 'agents');
    fs.mkdirSync(picksAgents, { recursive: true });
    const linkTarget = path.join(picksAgents, 'linked.agent.md');
    try {
      fs.symlinkSync(path.join(srcDir, 'original.agent.md'), linkTarget, 'file');
    } catch (err) {
      // Fallback on systems that disallow file symlinks — just copy so the test
      // still exercises the scanner path for non-symlink files.
      fs.copyFileSync(path.join(srcDir, 'original.agent.md'), linkTarget);
    }

    const result = await scanner.scanPath(path.join(tempDir, 'picks'), {});
    assert.equal(result.length, 1);
    const agents = result[0].assets.filter(a => a.type === AssetType.Agent);
    assert.equal(agents.length, 1, 'Scanner should discover the symlinked asset');
    assert.equal(path.basename(agents[0].sourcePath), 'linked.agent.md');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('scanPath - follows directory junctions/symlinks for folder assets inside toolkit root', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-symlink-dir');

  try {
    // Real skill folder — inside the toolkit root so containment allows it
    const srcSkill = path.join(tempDir, 'src', 'my-skill');
    fs.mkdirSync(srcSkill, { recursive: true });
    fs.writeFileSync(path.join(srcSkill, 'SKILL.md'), '# skill');

    // Skills dir with a junction/symlink to the skill folder (same root)
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const linkTarget = path.join(skillsDir, 'my-skill');
    try {
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(srcSkill, linkTarget, type);
    } catch {
      // Fallback: copy the folder
      fs.cpSync(srcSkill, linkTarget, { recursive: true });
    }

    // Scan the entire tempDir — both src/ and skills/ are inside the toolkit root
    const result = await scanner.scanPath(tempDir, {});
    assert.equal(result.length, 1);
    const skills = result[0].assets.filter(a => a.type === AssetType.Skill);
    assert.equal(skills.length, 1, 'Scanner should discover the junction-linked skill folder within root');
    assert.equal(skills[0].isFolder, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('scanPath - directory junctions/symlinks escaping toolkit root are ignored', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-symlink-dir-escape');
  const outsideDir = makeTempDir('test-outside-skill');

  try {
    // Real skill folder — outside the toolkit root
    const srcSkill = path.join(outsideDir, 'my-skill');
    fs.mkdirSync(srcSkill, { recursive: true });
    fs.writeFileSync(path.join(srcSkill, 'SKILL.md'), '# skill');

    // Picks dir with a junction/symlink to the external skill folder
    const picksSkills = path.join(tempDir, 'skills');
    fs.mkdirSync(picksSkills, { recursive: true });
    const linkTarget = path.join(picksSkills, 'my-skill');
    try {
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(srcSkill, linkTarget, type);
    } catch {
      // Symlinks not available — skip test
      return;
    }

    const result = await scanner.scanPath(tempDir, {});
    // The escaped junction should be ignored, leaving zero assets → no toolkit
    assert.equal(result.length, 0, 'Scanner should not discover assets from escaped junction');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

// --- Symlink containment ---

test('scanPath - symlinks pointing outside toolkit root are ignored', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-symlink-escape');
  const outsideDir = makeTempDir('test-outside-target');

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'agents', 'legit.agent.md'), '# Legit');
    fs.writeFileSync(path.join(outsideDir, 'evil.agent.md'), '# Evil');
    try {
      fs.symlinkSync(outsideDir, path.join(tempDir, 'agents', 'escaped'), 'dir');
    } catch {
      // Symlinks may not be supported — skip test
      return;
    }

    const result = await scanner.scanPath(tempDir, {});
    assert.equal(result.length, 1);
    const agentAssets = result[0].assets.filter(a => a.type === 'agents');
    for (const asset of agentAssets) {
      assert.ok(
        !asset.sourcePath.includes('evil'),
        `Should not discover assets from escaped symlink: ${asset.sourcePath}`
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

// --- Folder-asset drill-down ---

test('scanPath - folder assets expose children array of contained files', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-folder-children');

  try {
    const skillDir = path.join(tempDir, 'skills', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
    fs.writeFileSync(path.join(skillDir, 'helper.sh'), '#!/bin/sh\n');
    fs.mkdirSync(path.join(skillDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'nested', 'note.md'), '# nested');

    const result = await scanner.scanPath(tempDir, {});
    assert.equal(result.length, 1);
    const skill = result[0].assets.find(a => a.type === AssetType.Skill && a.isFolder);
    assert.ok(skill, 'Should find a skill folder asset');
    assert.ok(Array.isArray(skill.children), 'Skill should have children array');
    assert.ok(skill.children.length >= 2, 'Should list direct files');

    const names = skill.children.map(c => c.name);
    assert.ok(names.includes('SKILL.md'));
    assert.ok(names.includes('helper.sh'));

    const nested = skill.children.find(c => c.name === 'nested' && c.isFolder);
    assert.ok(nested, 'Nested subfolder should be a child');
    assert.ok(nested.children && nested.children.find(c => c.name === 'note.md'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
