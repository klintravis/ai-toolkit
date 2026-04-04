const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ToolkitScanner } = require('../out/scanner.js');
const { SourceFormat, AssetType } = require('../out/types.js');

/**
 * Unit tests for ToolkitScanner.
 * Tests asset discovery for CopilotCustomizer format and edge cases.
 */

test('scanPath - nonexistent path returns empty array', async () => {
  const scanner = new ToolkitScanner();
  const nonexistentPath = path.join(os.tmpdir(), 'nonexistent-' + Date.now());
  const result = await scanner.scanPath(nonexistentPath, {});
  assert.deepEqual(result, []);
});

test('scanPath - CopilotCustomizer format with .github structure', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = path.join(os.tmpdir(), 'test-toolkit-' + Date.now());
  
  try {
    // Create CopilotCustomizer-style structure
    const githubDir = path.join(tempDir, '.github');
    const agentsDir = path.join(githubDir, 'agents');
    const instructionsDir = path.join(githubDir, 'instructions');
    const skillsDir = path.join(githubDir, 'skills');
    const promptsDir = path.join(githubDir, 'prompts');
    
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(instructionsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(promptsDir, { recursive: true });
    
    // Create sample assets
    fs.writeFileSync(
      path.join(agentsDir, 'test-agent.agent.md'),
      '---\nname: test-agent\n---\n# Test Agent'
    );
    fs.writeFileSync(
      path.join(instructionsDir, 'coding.instructions.md'),
      '---\napplyTo: "**/*.ts"\n---\n# Coding Standards'
    );
    fs.writeFileSync(
      path.join(promptsDir, 'review.prompt.md'),
      '---\nname: review\n---\n# Code Review'
    );
    
    // Create a skill folder with SKILL.md
    const skillDir = path.join(skillsDir, 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\n---\n# Test Skill'
    );
    
    // Scan the toolkit
    const result = await scanner.scanPath(tempDir, {});
    
    // Verify results
    assert.equal(result.length, 1, 'Should discover exactly one toolkit');
    
    const toolkit = result[0];
    assert.equal(toolkit.format, SourceFormat.CopilotCustomizer);
    assert.equal(toolkit.rootPath, tempDir);
    assert.equal(toolkit.enabled, false); // Default disabled
    
    // Check that assets were discovered
    assert.ok(toolkit.assets.length >= 4, `Should discover at least 4 assets, found ${toolkit.assets.length}`);
    
    // Verify specific asset types are present
    const agentAssets = toolkit.assets.filter(a => a.type === AssetType.Agent);
    const instructionAssets = toolkit.assets.filter(a => a.type === AssetType.Instruction);
    const promptAssets = toolkit.assets.filter(a => a.type === AssetType.Prompt);
    const skillAssets = toolkit.assets.filter(a => a.type === AssetType.Skill);
    
    assert.equal(agentAssets.length, 1, 'Should discover 1 agent');
    assert.equal(instructionAssets.length, 1, 'Should discover 1 instruction');
    assert.equal(promptAssets.length, 1, 'Should discover 1 prompt');
    assert.equal(skillAssets.length, 1, 'Should discover 1 skill');
    
    // Verify agent details
    const agent = agentAssets[0];
    assert.equal(agent.name, 'Test Agent');
    assert.equal(agent.isFolder, false);
    assert.ok(agent.relativePath.includes('agents/test-agent.agent.md'));
    
    // Verify skill is folder-based
    const skill = skillAssets[0];
    assert.equal(skill.isFolder, true);
    assert.equal(skill.name, 'Test Skill');
    
  } finally {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('scanPath - empty .github directory returns no toolkits', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = path.join(os.tmpdir(), 'test-empty-' + Date.now());
  
  try {
    // Create .github dir but no asset folders
    const githubDir = path.join(tempDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });
    
    const result = await scanner.scanPath(tempDir, {});
    assert.deepEqual(result, [], 'Empty .github should return no toolkits');
    
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('scanPath - enabled toolkit is marked correctly', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = path.join(os.tmpdir(), 'test-enabled-' + Date.now());
  
  try {
    // Create minimal toolkit
    const githubDir = path.join(tempDir, '.github');
    const agentsDir = path.join(githubDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'test.agent.md'),
      '---\nname: test\n---\n# Test'
    );
    
    // Generate expected toolkit ID (last two path segments)
    const parts = tempDir.replace(/\\/g, '/').split('/').filter(Boolean);
    const expectedId = parts.slice(-2).join('/');
    
    // Scan with toolkit enabled
    const result = await scanner.scanPath(tempDir, { [expectedId]: true });
    
    assert.equal(result.length, 1);
    assert.equal(result[0].enabled, true, 'Toolkit should be marked as enabled');
    
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('scanPath - handles multiple toolkits in subdirectories', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = path.join(os.tmpdir(), 'test-multi-' + Date.now());
  
  try {
    // Create two separate toolkits as subdirectories
    const toolkit1 = path.join(tempDir, 'toolkit-one');
    const toolkit2 = path.join(tempDir, 'toolkit-two');
    
    // Toolkit 1 structure
    const github1 = path.join(toolkit1, '.github', 'agents');
    fs.mkdirSync(github1, { recursive: true });
    fs.writeFileSync(path.join(github1, 'agent1.agent.md'), '# Agent 1');
    
    // Toolkit 2 structure
    const github2 = path.join(toolkit2, '.github', 'prompts');
    fs.mkdirSync(github2, { recursive: true });
    fs.writeFileSync(path.join(github2, 'prompt2.prompt.md'), '# Prompt 2');
    
    // Scan parent directory
    const result = await scanner.scanPath(tempDir, {});
    
    assert.equal(result.length, 2, 'Should discover 2 toolkits');
    assert.ok(result.some(t => t.name === 'toolkit-one'), 'Should find toolkit-one');
    assert.ok(result.some(t => t.name === 'toolkit-two'), 'Should find toolkit-two');
    
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});
