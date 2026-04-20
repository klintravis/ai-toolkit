const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildToolkitFolderLayout, countFolderAssets } = require('../out/treeModel.js');
const { requireFresh, withMockedVscode } = require('./helpers/mockVscode');

test('ToolkitTreeProvider - constructs without deps', () => {
  withMockedVscode(() => {
    const { ToolkitTreeProvider } = requireFresh('./out/treeProvider.js');
    const tp = new ToolkitTreeProvider();
    assert.ok(tp);
  });
});

test('ToolkitTreeProvider - renders folder-first nodes and menu context values', () => {
  withMockedVscode((vscode) => {
    const { ToolkitTreeProvider } = requireFresh('./out/treeProvider.js');
    const provider = new ToolkitTreeProvider();
    const pinnedAsset = asset('copilot/agents/reviewer.agent.md', 'Reviewer');
    const skillAsset = asset('claude/skills/code-review', 'Code Review', {
      isFolder: true,
      platform: 'both',
      children: [
        asset('claude/skills/code-review/SKILL.md', 'SKILL.md', { platform: 'both' }),
      ],
    });

    provider.setPinProvider({
      findPinRecord: (candidate) => candidate.id === pinnedAsset.id ? { groupName: 'default' } : undefined,
    });
    provider.setToolkits(new Map([
      ['/tmp/toolkits', [{
        id: 'toolkit',
        name: 'Toolkit',
        rootPath: '/tmp/toolkit',
        format: 'dual-platform',
        assets: [pinnedAsset, skillAsset],
        enabled: true,
      }]],
    ]));

    const [sectionNode] = provider.getChildren();
    const [toolkitNode] = provider.getChildren(sectionNode);
    const toolkitItem = provider.getTreeItem(toolkitNode);
    assert.equal(toolkitItem.contextValue, 'toolkit-enabled-external');
    assert.equal(toolkitItem.description, undefined);

    const folderNodes = provider.getChildren(toolkitNode);
    assert.deepEqual(folderNodes.map(node => node.folder.name), ['Agents', 'Skills']);

    const agentsItem = provider.getTreeItem(folderNodes[0]);
    assert.equal(agentsItem.label, 'Agents');
    assert.equal(agentsItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

    const [pinnedNode] = provider.getChildren(folderNodes[0]);
    const pinnedItem = provider.getTreeItem(pinnedNode);
    assert.equal(pinnedItem.contextValue, 'asset-enabled-pinned');
    assert.equal(pinnedItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.equal(pinnedItem.command.command, 'aiToolkit.openAsset');

    const [skillNode] = provider.getChildren(folderNodes[1]);
    const skillItem = provider.getTreeItem(skillNode);
    assert.equal(skillItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

    const [skillChildNode] = provider.getChildren(skillNode);
    const skillChildItem = provider.getTreeItem(skillChildNode);
    assert.equal(skillChildItem.contextValue, 'asset-child');
  });
});

test('buildToolkitFolderLayout - collapses dual-platform wrappers into direct asset folders', () => {
  const layout = buildToolkitFolderLayout([
    asset('copilot/agents/reviewer.agent.md', 'Reviewer'),
    asset('claude/hooks/lint.json', 'Lint Hook'),
    asset('shared/docs/guide.md', 'Guide'),
  ]);

  assert.deepEqual(layout.assets, []);
  assert.deepEqual(layout.folders.map(folder => folder.name), ['Agents', 'Hooks', 'Docs']);
  assert.deepEqual(layout.folders.map(folder => folder.relativePath), ['copilot/agents', 'claude/hooks', 'shared/docs']);
  assert.equal(layout.folders[0].assets[0].name, 'Reviewer');
  assert.equal(layout.folders[1].assets[0].name, 'Lint Hook');
  assert.equal(layout.folders[2].assets[0].name, 'Guide');
});

test('buildToolkitFolderLayout - disambiguates duplicate folder names by platform when needed', () => {
  const layout = buildToolkitFolderLayout([
    asset('copilot/instructions/reviewer.instructions.md', 'Copilot Reviewer'),
    asset('claude/instructions/reviewer.md', 'Claude Reviewer'),
  ]);

  assert.deepEqual(layout.folders.map(folder => folder.name), ['Copilot Instructions', 'Claude Instructions']);
  assert.deepEqual(layout.folders.map(folder => folder.relativePath), ['copilot/instructions', 'claude/instructions']);
});

test('buildToolkitFolderLayout - preserves direct asset folders for legacy and flat layouts', () => {
  const layout = buildToolkitFolderLayout([
    asset('agents/flat.agent.md', 'Flat Agent'),
    asset('.github/agents/legacy.agent.md', 'Legacy Agent'),
  ]);

  assert.deepEqual(layout.folders.map(folder => folder.name), ['Agents', 'GitHub Agents']);
  assert.equal(layout.folders[0].relativePath, 'agents');
  assert.equal(layout.folders[0].assets[0].name, 'Flat Agent');
  assert.equal(layout.folders[1].relativePath, '.github/agents');
  assert.equal(layout.folders[1].assets[0].name, 'Legacy Agent');
  assert.equal(countFolderAssets(layout.folders[1]), 1);
});

// Pure-logic tests: contextValue regex patterns from package.json menus.
// These exercise no module imports and validate the shape of contextValue
// strings that the tree provider emits (used in when-clause guards).

test('contextValue regex - addToWorkspace pattern matches real toolkits only', () => {
  const re = /^toolkit-(enabled|disabled)-(cloned|external)(-updatable)?$/;
  assert.ok(re.test('toolkit-enabled-cloned'));
  assert.ok(re.test('toolkit-disabled-external'));
  assert.ok(re.test('toolkit-enabled-external'));
  assert.ok(re.test('toolkit-disabled-cloned'));
  assert.ok(re.test('toolkit-enabled-cloned-updatable'));
  assert.ok(!re.test('toolkit-enabled-cloned-group'));
  assert.ok(!re.test('toolkit-group'));
  assert.ok(!re.test('asset-enabled'));
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
  assert.ok(unpinRe.test('asset-child-pinned'));
  assert.ok(!pinRe.test('asset-child-pinned'));
  // An unpinned asset should match pin but not unpin
  assert.ok(pinRe.test('asset-enabled'));
  assert.ok(!unpinRe.test('asset-enabled'));
  // Disabled unpinned asset
  assert.ok(pinRe.test('asset-disabled'));
  assert.ok(!unpinRe.test('asset-disabled'));
  // Nested support files are never pinnable as new picks
  assert.ok(!pinRe.test('asset-child'));
  assert.ok(!unpinRe.test('asset-child'));
});

test('contextValue regex - group deletion pattern matches group nodes', () => {
  const re = /^toolkit-.*-group/;
  assert.ok(re.test('toolkit-enabled-cloned-group'));
  assert.ok(re.test('toolkit-disabled-external-group'));
  assert.ok(!re.test('toolkit-enabled-cloned'));
  assert.ok(!re.test('asset-enabled'));
});

function asset(relativePath, name, options = {}) {
  const parts = relativePath.split('/');
  const last = parts[parts.length - 1];
  const type = parts.length > 1 ? parts[parts.length - 2] : 'agents';
  return {
    id: `toolkit::${relativePath}`,
    name,
    type: options.type ?? type,
    sourcePath: `/tmp/${relativePath}`,
    relativePath,
    isFolder: options.isFolder ?? !last.includes('.'),
    platform: options.platform ?? 'copilot',
    children: options.children,
  };
}
