# DualPlatform Claude Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two legacy Copilot-only toolkit formats with a single DualPlatform format that supports Claude Code assets (skills, hooks, MCPs) alongside Copilot assets, with all folder-to-platform mappings configurable in VS Code settings.

**Architecture:** New `DualPlatform` format uses `copilot/`, `claude/`, and `shared/` top-level subfolders. An `AssetMapping[]` (from VS Code settings + optional per-repo `ai-toolkit.json`) drives scanning instead of hardcoded type detection. A new `ClaudeSettingsManager` writes to `~/.claude/settings.json` using Node.js `fs` directly.

**Tech Stack:** TypeScript strict mode, VS Code Extension API, Node.js `fs`, `node:test` + `node:assert/strict` for tests.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/types.ts` | Modify | Open `AssetType`, `platform` on `Asset`/`PinRecord`, `AssetMapping`, `ToolkitManifest`, simplified `SourceFormat` |
| `src/scanner.ts` | Rewrite | DualPlatform-only detection, mapping-driven scan, manifest loading |
| `src/copilotSettings.ts` | Modify | Platform filter, updated `getDiscoveryFolders` |
| `src/claudeSettings.ts` | **Create** | `ClaudeSettingsManager` — hooks, MCPs, skill symlinks |
| `src/treeProvider.ts` | Modify | Open-type labels/icons, platform badges |
| `src/picks.ts` | Modify | `platform` on `PinRecord` |
| `src/extension.ts` | Modify | Wire `ClaudeSettingsManager`, migration warning |
| `package.json` | Modify | New settings, updated test script |
| `test/scanner.test.js` | Rewrite | DualPlatform fixtures, old format tests removed |
| `test/claudeSettings.test.js` | **Create** | Hooks, MCPs, skill symlinks, create-if-missing, malformed JSON |
| `test/picks.test.js` | Modify | Add `platform` to `PinRecord` fixtures |

---

## Task 1: Update types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Replace AssetType enum with open string type**

Replace the entire `AssetType` enum in `src/types.ts` with:

```typescript
export type AssetType = string;
export const AssetType = {
  Agent: 'agents',
  Instruction: 'instructions',
  Skill: 'skills',
  Prompt: 'prompts',
  Plugin: 'plugins',
  Hook: 'hooks',
  Workflow: 'workflows',
  McpServer: 'mcps',
  Standard: 'standards',
  Doc: 'docs',
} as const;
```

- [ ] **Step 2: Replace SourceFormat enum**

Replace the `SourceFormat` enum with:

```typescript
export enum SourceFormat {
  DualPlatform = 'dual-platform',
}
```

- [ ] **Step 3: Add `platform` to `Asset` and new interfaces**

Add `platform` to `Asset` and add `AssetMapping` + `ToolkitManifest`:

```typescript
export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  sourcePath: string;
  relativePath: string;
  isFolder: boolean;
  children?: Asset[];
  platform: 'copilot' | 'claude' | 'both' | 'shared';
}

export interface AssetMapping {
  /** Relative path from toolkit root, e.g. "claude/skills" */
  folder: string;
  /** Asset type string, e.g. "skills" or "mcps" */
  assetType: AssetType;
  platform: 'copilot' | 'claude' | 'both' | 'shared';
  /** When true, each subdir is a folder asset. When false, walk for files. */
  isFolder?: boolean;
  /** File extensions to accept, e.g. [".agent.md"]. Falls back to .md/.json/.yaml. */
  extensions?: string[];
}

export interface ToolkitManifest {
  name?: string;
  mappings?: AssetMapping[];
}
```

- [ ] **Step 4: Add `platform` to `PinRecord`**

Add `platform: 'copilot' | 'claude' | 'both' | 'shared'` to the `PinRecord` interface (after `isFolder`).

- [ ] **Step 5: Compile to verify no errors**

```bash
npm run compile 2>&1 | head -40
```

Expected: TypeScript errors from files that use the old `SourceFormat.AwesomeCopilot` / `CopilotCustomizer` values or `AssetType` as an enum. These are expected — they will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "refactor(types): open AssetType string, add platform/AssetMapping/ToolkitManifest"
```

---

## Task 2: Rewrite scanner.ts

**Files:**
- Modify: `src/scanner.ts`

- [ ] **Step 1: Write failing tests for DualPlatform scanner**

Replace the entire contents of `test/scanner.test.js` with:

```javascript
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
    assert.equal(tk.assets.length, 6);

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
    // Missing required fields in one entry; valid toolkit still scans
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
    } catch { return; }
    const result = await scanner.scanPath(dir, {});
    assert.equal(result.length, 0, 'Escaped symlink should produce no assets');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// --- DEFAULT_ASSET_MAPPINGS export ---

test('DEFAULT_ASSET_MAPPINGS is exported and has expected entries', () => {
  assert.ok(Array.isArray(DEFAULT_ASSET_MAPPINGS));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'claude/skills' && m.platform === 'both'));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'copilot/agents' && m.platform === 'copilot'));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'claude/mcps' && m.platform === 'claude'));
  assert.ok(DEFAULT_ASSET_MAPPINGS.some(m => m.folder === 'shared/standards' && m.platform === 'shared'));
});
```

- [ ] **Step 2: Compile and confirm tests fail**

```bash
npm run compile && node --test test/scanner.test.js 2>&1 | head -20
```

Expected: compile errors or test failures referencing old scanner API.

- [ ] **Step 3: Rewrite src/scanner.ts**

Replace `src/scanner.ts` entirely:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { pathExists, toToolkitId } from './pathUtils';
import { Asset, AssetMapping, AssetType, SourceFormat, Toolkit, ToolkitManifest } from './types';

const MAX_SCAN_DEPTH = 5;
const EXCLUDED_FILENAMES = new Set([
  'readme.md', 'changelog.md', 'license.md', 'contributing.md',
]);

export const DEFAULT_ASSET_MAPPINGS: AssetMapping[] = [
  { folder: 'copilot/agents',       assetType: AssetType.Agent,       platform: 'copilot', isFolder: false, extensions: ['.agent.md'] },
  { folder: 'copilot/instructions', assetType: AssetType.Instruction, platform: 'copilot', isFolder: false, extensions: ['.instructions.md'] },
  { folder: 'copilot/prompts',      assetType: AssetType.Prompt,      platform: 'copilot', isFolder: false, extensions: ['.prompt.md'] },
  { folder: 'copilot/plugins',      assetType: AssetType.Plugin,      platform: 'copilot', isFolder: true },
  { folder: 'copilot/hooks',        assetType: AssetType.Hook,        platform: 'copilot', isFolder: true },
  { folder: 'copilot/workflows',    assetType: AssetType.Workflow,    platform: 'copilot', isFolder: false, extensions: ['.md'] },
  { folder: 'claude/skills',        assetType: AssetType.Skill,       platform: 'both',    isFolder: true },
  { folder: 'claude/hooks',         assetType: AssetType.Hook,        platform: 'claude',  isFolder: false, extensions: ['.json'] },
  { folder: 'claude/mcps',          assetType: AssetType.McpServer,   platform: 'claude',  isFolder: false, extensions: ['.json'] },
  { folder: 'claude/instructions',  assetType: AssetType.Instruction, platform: 'claude',  isFolder: false, extensions: ['.md'] },
  { folder: 'shared/standards',     assetType: AssetType.Standard,    platform: 'shared',  isFolder: true },
  { folder: 'shared/docs',          assetType: AssetType.Doc,         platform: 'shared',  isFolder: false, extensions: ['.md'] },
];

export class ToolkitScanner {
  async scanPath(
    rootPath: string,
    enabledToolkits: Record<string, boolean>,
    mappings: AssetMapping[] = DEFAULT_ASSET_MAPPINGS,
  ): Promise<Toolkit[]> {
    const resolved = path.resolve(rootPath);
    if (!(await pathExists(resolved))) return [];

    if (await this.isDualPlatformToolkit(resolved, mappings)) {
      const toolkit = await this.scanToolkit(resolved, mappings, enabledToolkits);
      return toolkit ? [toolkit] : [];
    }

    const toolkits: Toolkit[] = [];
    const entries = await this.readDirSafe(resolved);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const subPath = path.join(resolved, entry.name);
      if (await this.isDualPlatformToolkit(subPath, mappings)) {
        const toolkit = await this.scanToolkit(subPath, mappings, enabledToolkits);
        if (toolkit) toolkits.push(toolkit);
      }
    }
    return toolkits;
  }

  private async isDualPlatformToolkit(dirPath: string, mappings: AssetMapping[]): Promise<boolean> {
    const topFolders = new Set(mappings.map(m => m.folder.split('/')[0]));
    for (const folder of topFolders) {
      if (await isDirectory(path.join(dirPath, folder))) return true;
    }
    return false;
  }

  private async scanToolkit(
    rootPath: string,
    mappings: AssetMapping[],
    enabledToolkits: Record<string, boolean>,
  ): Promise<Toolkit | null> {
    const id = toToolkitId(rootPath);
    const manifest = await this.loadManifest(rootPath);
    const effectiveMappings = manifest?.mappings
      ? [...mappings, ...manifest.mappings]
      : mappings;
    const displayName = manifest?.name ?? path.basename(rootPath);

    let toolkitRealRoot: string;
    try {
      toolkitRealRoot = (await fs.promises.realpath(rootPath)).replace(/\\/g, '/').toLowerCase();
    } catch {
      toolkitRealRoot = rootPath.replace(/\\/g, '/').toLowerCase();
    }
    const visited = new Set<string>();
    const assets: Asset[] = [];
    const seen = new Set<string>();

    for (const mapping of effectiveMappings) {
      const folderPath = path.join(rootPath, ...mapping.folder.split('/'));
      if (!(await pathExists(folderPath))) continue;
      const discovered = await this.scanMappingFolder(
        folderPath, mapping, id, mapping.folder, MAX_SCAN_DEPTH, toolkitRealRoot, visited,
      );
      for (const asset of discovered) {
        if (!seen.has(asset.id)) { seen.add(asset.id); assets.push(asset); }
      }
    }

    if (assets.length === 0) return null;

    return { id, name: displayName, rootPath, format: SourceFormat.DualPlatform, assets, enabled: enabledToolkits[id] ?? false };
  }

  private async scanMappingFolder(
    folderPath: string,
    mapping: AssetMapping,
    toolkitId: string,
    relativeBase: string,
    depth: number,
    toolkitRealRoot: string,
    visited: Set<string>,
  ): Promise<Asset[]> {
    if (depth <= 0) return [];
    const assets: Asset[] = [];
    const entries = await this.readDirSafe(folderPath);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(folderPath, entry.name);
      const kind = await this.classifyEntry(fullPath, entry, toolkitRealRoot, visited);

      if (mapping.isFolder) {
        if (kind.isDirectory) {
          const relativePath = `${relativeBase}/${entry.name}`;
          const assetId = `${toolkitId}::${relativePath}`;
          const children = await this.scanFolderContents(fullPath, mapping.assetType, assetId, relativePath, depth - 1, toolkitRealRoot, visited);
          assets.push({
            id: assetId, name: this.deriveDisplayName(entry.name), type: mapping.assetType,
            sourcePath: fullPath, relativePath, isFolder: true, platform: mapping.platform, children,
          });
        }
      } else {
        if (kind.isFile && this.isAssetFile(entry.name, mapping)) {
          const relativePath = `${relativeBase}/${entry.name}`;
          assets.push({
            id: `${toolkitId}::${relativePath}`, name: this.deriveDisplayName(entry.name),
            type: mapping.assetType, sourcePath: fullPath, relativePath, isFolder: false, platform: mapping.platform,
          });
        } else if (kind.isDirectory) {
          const sub = await this.scanMappingFolder(fullPath, mapping, toolkitId, `${relativeBase}/${entry.name}`, depth - 1, toolkitRealRoot, visited);
          assets.push(...sub);
        }
      }
    }
    return assets;
  }

  private async scanFolderContents(
    folderPath: string, type: AssetType, parentId: string, parentRelPath: string,
    depth: number, toolkitRealRoot: string, visited: Set<string>,
  ): Promise<Asset[]> {
    if (depth <= 0) return [];
    const children: Asset[] = [];
    const entries = await this.readDirSafe(folderPath);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(folderPath, entry.name);
      const relativePath = `${parentRelPath}/${entry.name}`;
      const kind = await this.classifyEntry(fullPath, entry, toolkitRealRoot, visited);
      if (kind.isDirectory) {
        const nested = await this.scanFolderContents(fullPath, type, parentId, relativePath, depth - 1, toolkitRealRoot, visited);
        if (nested.length > 0) {
          children.push({ id: `${parentId}::${entry.name}`, name: entry.name, type, sourcePath: fullPath, relativePath, isFolder: true, platform: 'both', children: nested });
        }
      } else if (kind.isFile) {
        children.push({ id: `${parentId}::${entry.name}`, name: entry.name, type, sourcePath: fullPath, relativePath, isFolder: false, platform: 'both' });
      }
    }
    return children;
  }

  private async loadManifest(toolkitRoot: string): Promise<ToolkitManifest | null> {
    const manifestPath = path.join(toolkitRoot, 'ai-toolkit.json');
    try {
      const content = await fs.promises.readFile(manifestPath, 'utf-8');
      const raw = JSON.parse(content);
      if (typeof raw !== 'object' || raw === null) return null;
      const manifest: ToolkitManifest = {};
      if (typeof raw.name === 'string') manifest.name = raw.name;
      if (Array.isArray(raw.mappings)) {
        manifest.mappings = (raw.mappings as unknown[]).filter((m): m is AssetMapping => {
          if (typeof m !== 'object' || m === null) return false;
          const e = m as Record<string, unknown>;
          return typeof e.folder === 'string' &&
            typeof e.assetType === 'string' &&
            ['copilot', 'claude', 'both', 'shared'].includes(e.platform as string);
        });
      }
      return manifest;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[AI Toolkit] Invalid ai-toolkit.json at ${toolkitRoot}: ${err}`);
      }
      return null;
    }
  }

  private isAssetFile(filename: string, mapping: AssetMapping): boolean {
    const lower = filename.toLowerCase();
    if (EXCLUDED_FILENAMES.has(lower)) return false;
    if (mapping.extensions && mapping.extensions.length > 0) {
      return mapping.extensions.some(ext => lower.endsWith(ext.toLowerCase()));
    }
    return lower.endsWith('.md') || lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml');
  }

  private deriveDisplayName(filename: string): string {
    let name = filename;
    for (const suffix of ['.agent.md', '.instructions.md', '.prompt.md', '.md', '.json', '.yaml', '.yml']) {
      if (name.toLowerCase().endsWith(suffix)) { name = name.slice(0, -suffix.length); break; }
    }
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private async classifyEntry(
    fullPath: string, entry: fs.Dirent, toolkitRealRoot?: string, visited?: Set<string>,
  ): Promise<{ isFile: boolean; isDirectory: boolean }> {
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.promises.stat(fullPath);
        const realPath = await fs.promises.realpath(fullPath);
        if (stat.isDirectory() && toolkitRealRoot) {
          const norm = realPath.replace(/\\/g, '/').toLowerCase();
          const root = toolkitRealRoot.replace(/\\/g, '/').toLowerCase();
          if (norm !== root && !norm.startsWith(root + '/')) return { isFile: false, isDirectory: false };
        }
        if (stat.isDirectory() && visited) {
          const key = realPath.replace(/\\/g, '/').toLowerCase();
          if (visited.has(key)) return { isFile: false, isDirectory: false };
          visited.add(key);
        }
        return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
      } catch { return { isFile: false, isDirectory: false }; }
    }
    return { isFile: entry.isFile(), isDirectory: entry.isDirectory() };
  }

  private async readDirSafe(dirPath: string): Promise<fs.Dirent[]> {
    try {
      return await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Cannot read directory ${dirPath}:`, err);
      return [];
    }
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try { return (await fs.promises.stat(dirPath)).isDirectory(); } catch { return false; }
}
```

- [ ] **Step 4: Run scanner tests**

```bash
npm run compile && node --test test/scanner.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.ts test/scanner.test.js
git commit -m "feat(scanner): DualPlatform format with mapping-driven discovery"
```

---

## Task 3: Update CopilotSettingsManager

**Files:**
- Modify: `src/copilotSettings.ts`

- [ ] **Step 1: Update imports and remove hardcoded SourceFormat references**

At top of `src/copilotSettings.ts`, ensure `SourceFormat` import is removed (it's no longer needed in this file).

- [ ] **Step 2: Update `enableRequiredFeatureFlags` to filter by platform**

Replace the loop inside `enableRequiredFeatureFlags`:

```typescript
for (const toolkit of enabledToolkits) {
  for (const asset of toolkit.assets) {
    if (asset.platform === 'copilot' || asset.platform === 'both') {
      activeTypes.add(asset.type);
    }
  }
}
```

- [ ] **Step 3: Update `updateCodeGenInstructions` to filter by platform**

Replace the inner loop:

```typescript
for (const toolkit of enabledToolkits) {
  for (const asset of toolkit.assets) {
    if (asset.type === AssetType.Instruction && !asset.isFolder &&
        (asset.platform === 'copilot' || asset.platform === 'both')) {
      managedEntries.push({ file: asset.sourcePath });
    }
  }
}
```

- [ ] **Step 4: Rewrite `getDiscoveryFolders` to derive paths from asset sourcePaths**

Replace the entire `getDiscoveryFolders` method:

```typescript
private getDiscoveryFolders(toolkit: Toolkit, assetType: AssetType): string[] {
  const folders = new Set<string>();
  for (const asset of toolkit.assets) {
    if (asset.type !== assetType) continue;
    if (asset.platform !== 'copilot' && asset.platform !== 'both') continue;
    // Derive discovery folder: <root>/<top-two-path-segments>
    // e.g. claude/skills/my-skill → <root>/claude/skills
    //      copilot/agents/foo.agent.md → <root>/copilot/agents
    const relPath = path.relative(toolkit.rootPath, asset.sourcePath).replace(/\\/g, '/');
    const parts = relPath.split('/');
    if (parts.length >= 2) {
      folders.add(path.join(toolkit.rootPath, parts[0], parts[1]));
    }
  }
  return [...folders];
}
```

- [ ] **Step 5: Remove SourceFormat import if still present**

Search for `SourceFormat` in `copilotSettings.ts` and remove any usage — the manager no longer needs to know the format.

- [ ] **Step 6: Compile and run all tests**

```bash
npm run compile && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/copilotSettings.ts
git commit -m "feat(copilot-settings): filter assets by platform for DualPlatform format"
```

---

## Task 4: Create ClaudeSettingsManager

**Files:**
- Create: `src/claudeSettings.ts`
- Create: `test/claudeSettings.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/claudeSettings.test.js`:

```javascript
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
  try {
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);
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
  try {
    fs.writeFileSync(settingsPath, 'NOT JSON {{{{');
    const log = makeLog();
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, log, () => settingsPath, () => pluginsPath);
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
  try {
    const mcpFile = path.join(tmpDir, 'server.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ name: 'my-server', command: 'node', args: ['./index.js'] }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.McpServer, 'claude', 'my-server', mcpFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);
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
  try {
    const mcpFile = path.join(tmpDir, 'server.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ name: 'my-server', command: 'node', args: [] }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.McpServer, 'claude', 'my-server', mcpFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);

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
  try {
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: { 'user-server': { command: 'node', args: [] } } }));
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);
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
  try {
    const hookFile = path.join(tmpDir, 'lint.json');
    const hookScript = path.join(tmpDir, 'lint.sh');
    fs.writeFileSync(hookScript, '#!/bin/sh');
    fs.writeFileSync(hookFile, JSON.stringify({ event: 'PreToolUse', matcher: 'Bash', command: hookScript }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Hook, 'claude', 'lint', hookFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);
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
  try {
    const hookFile = path.join(tmpDir, 'lint.json');
    const hookScript = path.join(tmpDir, 'lint.sh');
    fs.writeFileSync(hookScript, '#!/bin/sh');
    fs.writeFileSync(hookFile, JSON.stringify({ event: 'PreToolUse', command: hookScript }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Hook, 'claude', 'lint', hookFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);

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
  try {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.Skill, 'both', 'my-skill', skillDir, true)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);
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
  try {
    const mcpFile = path.join(tmpDir, 'server.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ name: 'srv', command: 'node', args: ['./index.js'] }));
    const toolkit = makeToolkit(tmpDir, [makeAsset(AssetType.McpServer, 'claude', 'srv', mcpFile)]);
    const ctx = makeContext();
    const mgr = new ClaudeSettingsManager(ctx, makeLog(), () => settingsPath, () => pluginsPath);
    await mgr.applyToolkits([toolkit]);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const key = `${path.basename(tmpDir)}__srv`;
    const args = settings.mcpServers?.[key]?.args ?? [];
    assert.ok(path.isAbsolute(args[0]), 'Relative args should be resolved to absolute paths');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Compile and confirm tests fail**

```bash
npm run compile && node --test test/claudeSettings.test.js 2>&1 | head -10
```

Expected: `Cannot find module '../out/claudeSettings.js'`

- [ ] **Step 3: Create src/claudeSettings.ts**

Create `src/claudeSettings.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { expandHomePath } from './pathUtils';
import { AssetType, GlobalStateContext, OutputLog, Toolkit } from './types';

const MANAGED_STATE_KEY = 'aiToolkit.claudeManagedEntries';

interface ClaudeManagedState {
  managedMcpKeys: string[];
  managedHookCommands: string[];
  managedPluginPaths: string[];
}

interface ClaudeSettings {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  [key: string]: unknown;
}

interface HookFile { event: string; matcher?: string; command: string; }
interface McpFile { name: string; command: string; args?: string[]; env?: Record<string, string>; }

export class ClaudeSettingsManager {
  constructor(
    private context: GlobalStateContext,
    private log: OutputLog,
    private getSettingsPath: () => string,
    private getPluginsPath: () => string,
  ) {}

  async applyToolkits(toolkits: Toolkit[]): Promise<void> {
    const enabled = toolkits.filter(t => t.enabled);
    await this.applyHooksAndMcps(enabled);
    await this.applySkillPlugins(enabled);
  }

  private async applyHooksAndMcps(toolkits: Toolkit[]): Promise<void> {
    const settingsPath = expandHomePath(this.getSettingsPath());
    const current = await this.readSettings(settingsPath);
    if (current === null) return;

    const managed = this.getManagedState();

    // Remove previously-managed hooks
    if (current.hooks) {
      for (const event of Object.keys(current.hooks)) {
        current.hooks[event] = (current.hooks[event] ?? []).filter(group => {
          const cmd = group.hooks?.[0]?.command;
          return !cmd || !managed.managedHookCommands.includes(cmd);
        });
        if (current.hooks[event].length === 0) delete current.hooks[event];
      }
      if (Object.keys(current.hooks).length === 0) delete current.hooks;
    }

    // Remove previously-managed MCPs
    for (const key of managed.managedMcpKeys) {
      delete current.mcpServers?.[key];
    }
    if (current.mcpServers && Object.keys(current.mcpServers).length === 0) {
      delete current.mcpServers;
    }

    const newHookCommands: string[] = [];
    const newMcpKeys: string[] = [];

    for (const toolkit of toolkits) {
      const tkName = path.basename(toolkit.rootPath);

      for (const asset of toolkit.assets) {
        if (asset.type === AssetType.Hook && asset.platform === 'claude' && !asset.isFolder) {
          const hookContent = await this.readJson<HookFile>(asset.sourcePath);
          if (!hookContent?.event || !hookContent?.command) continue;
          const absCmd = path.isAbsolute(hookContent.command)
            ? hookContent.command
            : path.join(toolkit.rootPath, hookContent.command);
          if (!current.hooks) current.hooks = {};
          if (!current.hooks[hookContent.event]) current.hooks[hookContent.event] = [];
          const entry: { matcher?: string; hooks: Array<{ type: string; command: string }> } = {
            hooks: [{ type: 'command', command: absCmd }],
          };
          if (hookContent.matcher) entry.matcher = hookContent.matcher;
          current.hooks[hookContent.event].push(entry);
          newHookCommands.push(absCmd);
        }

        if (asset.type === AssetType.McpServer && asset.platform === 'claude' && !asset.isFolder) {
          const mcpContent = await this.readJson<McpFile>(asset.sourcePath);
          if (!mcpContent?.name || !mcpContent?.command) continue;
          const key = `${tkName}__${mcpContent.name}`;
          const resolvedArgs = (mcpContent.args ?? []).map(arg =>
            arg.startsWith('.') ? path.resolve(toolkit.rootPath, arg) : arg
          );
          if (!current.mcpServers) current.mcpServers = {};
          current.mcpServers[key] = {
            command: mcpContent.command,
            ...(resolvedArgs.length > 0 ? { args: resolvedArgs } : {}),
            ...(mcpContent.env && Object.keys(mcpContent.env).length > 0 ? { env: mcpContent.env } : {}),
          };
          newMcpKeys.push(key);
        }
      }
    }

    await this.writeSettings(settingsPath, current);
    await this.setManagedState({ ...managed, managedHookCommands: newHookCommands, managedMcpKeys: newMcpKeys });
    this.log.appendLine(`[AI Toolkit / Claude] Applied ${newHookCommands.length} hook(s), ${newMcpKeys.length} MCP(s)`);
  }

  private async applySkillPlugins(toolkits: Toolkit[]): Promise<void> {
    const pluginsRoot = expandHomePath(this.getPluginsPath());
    const managed = this.getManagedState();

    for (const pluginPath of managed.managedPluginPaths) {
      try {
        const stat = await fs.promises.lstat(pluginPath);
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          await fs.promises.rm(pluginPath, { recursive: true, force: true });
        }
      } catch { /* already gone */ }
    }

    const newPluginPaths: string[] = [];

    for (const toolkit of toolkits) {
      const skillAssets = toolkit.assets.filter(
        a => a.type === AssetType.Skill && (a.platform === 'both' || a.platform === 'claude') && a.isFolder
      );
      if (skillAssets.length === 0) continue;

      const tkName = path.basename(toolkit.rootPath);
      const pluginDir = path.join(pluginsRoot, tkName);
      const skillsDir = path.join(pluginDir, 'skills');
      await fs.promises.mkdir(skillsDir, { recursive: true });

      for (const skillAsset of skillAssets) {
        const linkPath = path.join(skillsDir, path.basename(skillAsset.sourcePath));
        try {
          await fs.promises.symlink(skillAsset.sourcePath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
            // Fallback: skip — skill directory already linked or unavailable
            this.log.appendLine(`[AI Toolkit / Claude] Could not link skill ${skillAsset.name}: ${err}`);
          }
        }
      }
      newPluginPaths.push(pluginDir);
    }

    await this.setManagedState({ ...managed, managedPluginPaths: newPluginPaths });
    this.log.appendLine(`[AI Toolkit / Claude] Materialized ${newPluginPaths.length} skill plugin dir(s)`);
  }

  private async readSettings(settingsPath: string): Promise<ClaudeSettings | null> {
    try {
      const content = await fs.promises.readFile(settingsPath, 'utf-8');
      return JSON.parse(content) as ClaudeSettings;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      this.log.appendLine(`[AI Toolkit / Claude] settings.json malformed — aborting: ${err}`);
      return null;
    }
  }

  private async writeSettings(settingsPath: string, settings: ClaudeSettings): Promise<void> {
    await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
    const tmp = `${settingsPath}.ai-toolkit-tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
    await fs.promises.rename(tmp, settingsPath);
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as T;
    } catch { return null; }
  }

  private getManagedState(): ClaudeManagedState {
    return this.context.globalState.get<ClaudeManagedState>(MANAGED_STATE_KEY) ?? {
      managedMcpKeys: [], managedHookCommands: [], managedPluginPaths: [],
    };
  }

  private async setManagedState(state: ClaudeManagedState): Promise<void> {
    await this.context.globalState.update(MANAGED_STATE_KEY, state);
  }
}
```

- [ ] **Step 4: Run ClaudeSettingsManager tests**

```bash
npm run compile && node --test test/claudeSettings.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/claudeSettings.ts test/claudeSettings.test.js
git commit -m "feat(claude-settings): ClaudeSettingsManager for hooks, MCPs, and skill plugins"
```

---

## Task 5: Update treeProvider.ts

**Files:**
- Modify: `src/treeProvider.ts`

- [ ] **Step 1: Replace hardcoded Record maps with open Maps + fallbacks**

Replace the `ASSET_TYPE_LABELS` and `ASSET_TYPE_ICONS` constants and `AssetTypeNode.label` type annotation:

```typescript
// Replace the two Record<AssetType, string> constants with Maps:
const ASSET_TYPE_LABELS = new Map<string, string>([
  ['agents', 'Agents'], ['instructions', 'Instructions'], ['skills', 'Skills'],
  ['prompts', 'Prompts'], ['plugins', 'Plugins'], ['hooks', 'Hooks'],
  ['workflows', 'Workflows'], ['standards', 'Standards'], ['mcps', 'MCP Servers'], ['docs', 'Docs'],
]);

const ASSET_TYPE_ICONS = new Map<string, string>([
  ['agents', 'robot'], ['instructions', 'book'], ['skills', 'tools'],
  ['prompts', 'comment-discussion'], ['plugins', 'extensions'], ['hooks', 'zap'],
  ['workflows', 'play-circle'], ['standards', 'law'], ['mcps', 'plug'], ['docs', 'file-text'],
]);

function getAssetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS.get(type) ?? (type.charAt(0).toUpperCase() + type.slice(1));
}

function getAssetTypeIcon(type: string): string {
  return ASSET_TYPE_ICONS.get(type) ?? 'file';
}
```

- [ ] **Step 2: Update getChildren toolkit case to use getAssetTypeLabel**

In `getChildren`, toolkit case, replace `label: ASSET_TYPE_LABELS[type]` with `label: getAssetTypeLabel(type)`.

- [ ] **Step 3: Update getAssetTypeItem to use getAssetTypeIcon**

Replace `item.iconPath = new vscode.ThemeIcon(ASSET_TYPE_ICONS[node.type])` with `item.iconPath = new vscode.ThemeIcon(getAssetTypeIcon(node.type))`.

- [ ] **Step 4: Add platform badge to asset description**

Add this helper function before the class:

```typescript
function getPlatformBadge(platform: string | undefined): string {
  switch (platform) {
    case 'both': return '[Both]';
    case 'claude': return '[Claude]';
    case 'shared': return '[Shared]';
    default: return '';
  }
}
```

In `getAssetItem`, update the description block to include the badge:

```typescript
const badge = !node.nested ? getPlatformBadge(asset.platform) : '';
const descParts: string[] = [];
if (hasChildren) { descParts.push(`${asset.children!.length}`); }
if (isPinned) { descParts.push(`📌 ${pinRecord!.groupName}`); }
if (badge) { descParts.push(badge); }
if (descParts.length > 0) { item.description = descParts.join(' · '); }
```

- [ ] **Step 5: Update toolkit description to show platform counts**

In `getToolkitItem`, replace the line `parts.push(\`${tk.assets.length}\`)` with:

```typescript
const copilotN = tk.assets.filter(a => a.platform === 'copilot').length;
const claudeN = tk.assets.filter(a => a.platform === 'claude').length;
const bothN = tk.assets.filter(a => a.platform === 'both').length;
const sharedN = tk.assets.filter(a => a.platform === 'shared').length;
const platformParts: string[] = [];
if (copilotN > 0) { platformParts.push(`Copilot:${copilotN}`); }
if (claudeN > 0) { platformParts.push(`Claude:${claudeN}`); }
if (bothN > 0) { platformParts.push(`Both:${bothN}`); }
if (sharedN > 0) { platformParts.push(`Shared:${sharedN}`); }
parts.push(platformParts.length > 0 ? platformParts.join(' | ') : `${tk.assets.length}`);
```

- [ ] **Step 6: Compile**

```bash
npm run compile 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/treeProvider.ts
git commit -m "feat(tree): open AssetType maps, platform badges on assets"
```

---

## Task 6: Update picks.ts and fix PinRecord platform

**Files:**
- Modify: `src/picks.ts`
- Modify: `test/picks.test.js`

- [ ] **Step 1: Add platform to PinRecord creation in materializeAndPin**

Search `picks.ts` for where `PinRecord` objects are constructed (`pinnedAt:` is a good anchor). Add `platform: asset.platform` to each construction site. The `asset` parameter already has `platform` from Task 1.

- [ ] **Step 2: Run existing picks tests to find failures**

```bash
npm run compile && node --test test/picks.test.js 2>&1 | head -30
```

- [ ] **Step 3: Fix any failing picks tests by adding platform to fixture assets**

In `test/picks.test.js`, find every place an asset or PinRecord fixture is created and add `platform: 'copilot'` (default for existing Copilot-style fixtures). Example pattern to search for: `type: AssetType.` — add `platform: 'copilot'` after each such occurrence in test fixtures.

- [ ] **Step 4: Run picks tests until they pass**

```bash
node --test test/picks.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/picks.ts test/picks.test.js
git commit -m "feat(picks): add platform field to PinRecord"
```

---

## Task 7: Wire ClaudeSettingsManager in extension.ts

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Import ClaudeSettingsManager**

Add to the import block at the top of `extension.ts`:

```typescript
import { ClaudeSettingsManager } from './claudeSettings';
```

- [ ] **Step 2: Declare module-level variable**

Add after the existing `let copilotSettings: CopilotSettingsManager;` line:

```typescript
let claudeSettings: ClaudeSettingsManager;
```

- [ ] **Step 3: Instantiate in activate()**

Add after the `copilotSettings = new CopilotSettingsManager(outputChannel);` line:

```typescript
claudeSettings = new ClaudeSettingsManager(
  context,
  outputChannel,
  () => vscode.workspace.getConfiguration('aiToolkit').get<string>('claudeSettingsPath', '~/.claude/settings.json'),
  () => vscode.workspace.getConfiguration('aiToolkit').get<string>('claudePluginsPath', '~/.ai-toolkits/claude-plugins'),
);
```

- [ ] **Step 4: Call applyToolkits in scanAndApplyToolkits()**

In `scanAndApplyToolkits()`, after the existing `await copilotSettings.applyToolkits(allToolkits)` block, add:

```typescript
await claudeSettings.applyToolkits(allToolkits);
```

- [ ] **Step 5: Call applyToolkits in toggleToolkit()**

In `toggleToolkit()`, after the existing `await copilotSettings.applyToolkits(allToolkits)` call:

```typescript
await claudeSettings.applyToolkits(allToolkits);
```

- [ ] **Step 6: Call applyToolkits in toggleAll()**

Same pattern — add after the existing `copilotSettings.applyToolkits` call.

- [ ] **Step 7: Add migration warning for old-format toolkits**

Add this helper function before `scanAndApplyToolkits`:

```typescript
async function warnIfOldFormatToolkits(toolkitPaths: string[], discoveredCount: number): Promise<void> {
  if (discoveredCount > 0) return; // At least one toolkit found, skip warning
  const OLD_FORMAT_INDICATORS = ['agents', 'instructions', 'skills', 'prompts'];
  for (const tkPath of toolkitPaths) {
    // Check top-level old format
    for (const folder of OLD_FORMAT_INDICATORS) {
      if (await pathExists(require('path').join(tkPath, folder))) {
        void vscode.window.showWarningMessage(
          `AI Toolkit: "${require('path').basename(tkPath)}" uses the old format. Migrate to copilot/ and claude/ subfolders to use the new DualPlatform format.`,
          'Learn More',
        );
        return;
      }
    }
    // Check .github/ old format
    const githubDir = require('path').join(tkPath, '.github');
    for (const folder of OLD_FORMAT_INDICATORS) {
      if (await pathExists(require('path').join(githubDir, folder))) {
        void vscode.window.showWarningMessage(
          `AI Toolkit: "${require('path').basename(tkPath)}" uses the old .github/ format. Migrate to the new DualPlatform layout.`,
          'Learn More',
        );
        return;
      }
    }
  }
}
```

In `scanAndApplyToolkits()`, after `allToolkits = discovered;`, add:

```typescript
await warnIfOldFormatToolkits(toolkitPaths, discovered.length);
```

- [ ] **Step 8: Compile**

```bash
npm run compile 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/extension.ts
git commit -m "feat(extension): wire ClaudeSettingsManager, add migration warning"
```

---

## Task 8: Update package.json settings

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add new configuration properties**

In the `"properties"` section of `contributes.configuration`, add after the existing `aiToolkit.managedToolkitRoots` entry:

```json
"aiToolkit.assetMappings": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["folder", "assetType", "platform"],
    "properties": {
      "folder": { "type": "string", "description": "Relative path from toolkit root, e.g. \"claude/skills\"" },
      "assetType": { "type": "string", "description": "Asset type identifier, e.g. \"skills\" or \"mcps\"" },
      "platform": { "type": "string", "enum": ["copilot", "claude", "both", "shared"] },
      "isFolder": { "type": "boolean", "description": "Each subdir is a folder asset when true; walk for files when false" },
      "extensions": { "type": "array", "items": { "type": "string" }, "description": "File extensions to accept, e.g. [\".agent.md\"]" }
    }
  },
  "default": [
    { "folder": "copilot/agents",       "assetType": "agents",       "platform": "copilot", "isFolder": false, "extensions": [".agent.md"] },
    { "folder": "copilot/instructions", "assetType": "instructions", "platform": "copilot", "isFolder": false, "extensions": [".instructions.md"] },
    { "folder": "copilot/prompts",      "assetType": "prompts",      "platform": "copilot", "isFolder": false, "extensions": [".prompt.md"] },
    { "folder": "copilot/plugins",      "assetType": "plugins",      "platform": "copilot", "isFolder": true },
    { "folder": "copilot/hooks",        "assetType": "hooks",        "platform": "copilot", "isFolder": true },
    { "folder": "copilot/workflows",    "assetType": "workflows",    "platform": "copilot", "isFolder": false, "extensions": [".md"] },
    { "folder": "claude/skills",        "assetType": "skills",       "platform": "both",    "isFolder": true },
    { "folder": "claude/hooks",         "assetType": "hooks",        "platform": "claude",  "isFolder": false, "extensions": [".json"] },
    { "folder": "claude/mcps",          "assetType": "mcps",         "platform": "claude",  "isFolder": false, "extensions": [".json"] },
    { "folder": "claude/instructions",  "assetType": "instructions", "platform": "claude",  "isFolder": false, "extensions": [".md"] },
    { "folder": "shared/standards",     "assetType": "standards",    "platform": "shared",  "isFolder": true },
    { "folder": "shared/docs",          "assetType": "docs",         "platform": "shared",  "isFolder": false, "extensions": [".md"] }
  ],
  "markdownDescription": "Asset folder-to-platform mappings. Edit to add new asset types or remap folders without code changes."
},
"aiToolkit.defaultRepositories": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["name", "url"],
    "properties": {
      "name": { "type": "string" },
      "url": { "type": "string" },
      "description": { "type": "string" }
    }
  },
  "default": [
    {
      "name": "Awesome Copilot",
      "url": "https://github.com/github/awesome-copilot",
      "description": "Official GitHub Copilot customizations"
    }
  ],
  "description": "Suggested toolkit repositories shown in the dashboard Clone panel."
},
"aiToolkit.claudeSettingsPath": {
  "type": "string",
  "default": "~/.claude/settings.json",
  "description": "Path to Claude Code's settings.json. Supports ~/ tilde paths."
},
"aiToolkit.claudePluginsPath": {
  "type": "string",
  "default": "~/.ai-toolkits/claude-plugins",
  "description": "Directory where AI Toolkit materializes Claude skill plugin folders. One subfolder per enabled toolkit."
}
```

- [ ] **Step 2: Update test script to include claudeSettings**

In `"scripts"`, update the `"test"` value:

```
"test": "npm run compile && node --test test/pathUtils.test.js test/scanner.test.js test/clonedToolkitsStore.test.js test/git.test.js test/updateChecker.test.js test/picks.test.js test/claudeSettings.test.js"
```

- [ ] **Step 3: Update description in package.json**

Replace the `"description"` value with:

```
"Manage AI toolkits from external folders — browse, enable, and configure Copilot and Claude Code assets (agents, instructions, skills, prompts, hooks, MCP servers) across workspaces."
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat(package): add assetMappings, defaultRepositories, claudeSettingsPath, claudePluginsPath settings"
```

---

## Task 9: Final validation

- [ ] **Step 1: Run full lint + test**

```bash
npm run check
```

Expected: No lint errors, all tests pass.

- [ ] **Step 2: Verify scanner exports compile cleanly**

```bash
node -e "const {ToolkitScanner, DEFAULT_ASSET_MAPPINGS} = require('./out/scanner.js'); console.log('OK', DEFAULT_ASSET_MAPPINGS.length, 'mappings')"
```

Expected: `OK 12 mappings`

- [ ] **Step 3: Verify claudeSettings exports**

```bash
node -e "const {ClaudeSettingsManager} = require('./out/claudeSettings.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: DualPlatform format complete — Copilot + Claude Code asset support"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Section 1 (Toolkit structure): scanner.ts DEFAULT_ASSET_MAPPINGS + tests
- ✅ Section 2 (Type model): Task 1 types.ts
- ✅ Section 3 (Configurable mappings): package.json defaults + per-toolkit manifest in scanner
- ✅ Section 4 (Scanner): Task 2
- ✅ Section 5 (Settings managers): Tasks 3 + 4
- ✅ Section 6 (Extension settings): Task 8
- ✅ Section 7 (Tree view): Task 5
- ✅ Section 8 (What changes): All modified files listed
- ✅ Section 9 (Migration): Task 7 migration warning
- ✅ Section 10 (Tests): Tasks 2 + 4 + 6

**Open questions from spec:**
- Claude Code plugin directory settings key: `ClaudeSettingsManager.applySkillPlugins` materializes symlinks but does NOT yet write a settings.json entry (the exact key is unconfirmed). Skills are linked into `~/.ai-toolkits/claude-plugins/<toolkit>/skills/` — manually configuring Claude Code to load from this path is required until the key is confirmed.
- CLAUDE.md import syntax: `claude/instructions/` assets are scanned and have `platform: 'claude'` but writing to CLAUDE.md is deferred pending syntax confirmation. The `ClaudeSettingsManager` logs these assets but takes no action on them.
