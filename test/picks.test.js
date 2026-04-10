const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PinRecordStore, PinManager, materializeAsset } = require('../out/picks.js');
const { AssetType } = require('../out/types.js');

function makeTempDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeContext() {
  const store = new Map();
  return {
    globalState: {
      get(key) { return store.get(key); },
      update(key, value) { store.set(key, value); return Promise.resolve(); },
    },
  };
}

function sink() { return { appendLine: () => {} }; }

function buildAsset(overrides) {
  return {
    id: 'tk1::agents/a.agent.md',
    name: 'A',
    type: AssetType.Agent,
    sourcePath: '/tmp/a.agent.md',
    relativePath: 'agents/a.agent.md',
    isFolder: false,
    platform: 'copilot',
    ...overrides,
  };
}

function buildToolkit(overrides) {
  return {
    id: 'tk1',
    name: 'Toolkit One',
    rootPath: '/tmp/tk1',
    format: 'awesome-copilot',
    assets: [],
    enabled: true,
    ...overrides,
  };
}

// --- PinRecordStore ---

function rec(overrides = {}) {
  return {
    assetId: 'id1', groupName: 'default', toolkitId: 'tk', toolkitName: 'T',
    assetType: AssetType.Agent, assetName: 'A', sourcePath: '/s', targetPath: '/t',
    linkType: 'copy', isFolder: false, pinnedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('PinRecordStore add/get/list/remove', async () => {
  const store = new PinRecordStore(fakeContext());
  assert.deepEqual(store.list(), []);
  await store.add(rec());
  assert.equal(store.list().length, 1);
  assert.ok(store.get('id1'));
  assert.equal(store.isPinned('id1'), true);
  await store.remove('id1');
  assert.equal(store.list().length, 0);
});

test('PinRecordStore.add with same assetId replaces', async () => {
  const store = new PinRecordStore(fakeContext());
  await store.add(rec({ sourcePath: '/s1', targetPath: '/t1' }));
  await store.add(rec({ sourcePath: '/s2', targetPath: '/t2' }));
  assert.equal(store.list().length, 1);
  assert.equal(store.get('id1').sourcePath, '/s2');
});

// --- materializeAsset ---

test('materializeAsset materializes a file (symlink or copy)', async () => {
  const tmp = makeTempDir('lc-file');
  try {
    const source = path.join(tmp, 'src.md');
    fs.writeFileSync(source, 'hello');
    const target = path.join(tmp, 'target', 'out.md');
    const kind = await materializeAsset(source, target, false);
    assert.ok(['symlink', 'copy'].includes(kind), `unexpected kind: ${kind}`);
    assert.equal(fs.readFileSync(target, 'utf8'), 'hello');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('materializeAsset materializes a folder (symlink, junction, or copy)', async () => {
  const tmp = makeTempDir('lc-dir');
  try {
    const source = path.join(tmp, 'srcdir');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'a.txt'), 'a');
    fs.writeFileSync(path.join(source, 'b.txt'), 'b');
    const target = path.join(tmp, 'out', 'link');
    const kind = await materializeAsset(source, target, true);
    assert.ok(['symlink', 'junction', 'copy'].includes(kind));
    assert.equal(fs.readFileSync(path.join(target, 'a.txt'), 'utf8'), 'a');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('materializeAsset removes and replaces existing target', async () => {
  const tmp = makeTempDir('lc-replace');
  try {
    const source = path.join(tmp, 'src.md');
    fs.writeFileSync(source, 'NEW');
    const target = path.join(tmp, 'out', 'existing.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'OLD');
    await materializeAsset(source, target, false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- PinManager ---

test('pin creates record and materializes file', async () => {
  const tmp = makeTempDir('pm-pin');
  try {
    const toolkitDir = path.join(tmp, 'tk');
    fs.mkdirSync(toolkitDir, { recursive: true });
    const sourceFile = path.join(toolkitDir, 'agent.agent.md');
    fs.writeFileSync(sourceFile, '# agent');
    const picksDir = path.join(tmp, 'picks');

    const store = new PinRecordStore(fakeContext());
    const pm = new PinManager(store, sink(), () => picksDir);
    await pm.ensureStructure();

    const asset = buildAsset({ sourcePath: sourceFile });
    const toolkit = buildToolkit({ rootPath: toolkitDir });
    const record = await pm.pin(asset, toolkit);

    assert.ok(record.targetPath.startsWith(picksDir));
    assert.equal(path.basename(record.targetPath), 'agent.agent.md');
    assert.ok(fs.existsSync(record.targetPath));
    assert.equal(store.list().length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pin twice is idempotent', async () => {
  const tmp = makeTempDir('pm-idem');
  try {
    const sourceFile = path.join(tmp, 'a.agent.md');
    fs.writeFileSync(sourceFile, '# a');
    const picksDir = path.join(tmp, 'picks');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    await pm.ensureStructure();
    const asset = buildAsset({ sourcePath: sourceFile });
    const toolkit = buildToolkit();
    const r1 = await pm.pin(asset, toolkit);
    const r2 = await pm.pin(asset, toolkit);
    assert.equal(r1.targetPath, r2.targetPath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pin collision resolves by adding toolkit slug prefix', async () => {
  const tmp = makeTempDir('pm-collide');
  try {
    const picksDir = path.join(tmp, 'picks');
    const tkA = path.join(tmp, 'a'); fs.mkdirSync(tkA);
    const tkB = path.join(tmp, 'b'); fs.mkdirSync(tkB);
    fs.writeFileSync(path.join(tkA, 'x.agent.md'), 'a');
    fs.writeFileSync(path.join(tkB, 'x.agent.md'), 'b');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    await pm.ensureStructure();
    const r1 = await pm.pin(
      buildAsset({ id: 'tkA::x', sourcePath: path.join(tkA, 'x.agent.md') }),
      buildToolkit({ id: 'tkA', name: 'Alpha', rootPath: tkA })
    );
    const r2 = await pm.pin(
      buildAsset({ id: 'tkB::x', sourcePath: path.join(tkB, 'x.agent.md') }),
      buildToolkit({ id: 'tkB', name: 'Beta', rootPath: tkB })
    );
    assert.notEqual(r1.targetPath, r2.targetPath);
    assert.equal(path.basename(r1.targetPath), 'x.agent.md');
    assert.ok(path.basename(r2.targetPath).includes('beta'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unpin removes target and record', async () => {
  const tmp = makeTempDir('pm-unpin');
  try {
    const sourceFile = path.join(tmp, 'a.agent.md');
    fs.writeFileSync(sourceFile, '# a');
    const picksDir = path.join(tmp, 'picks');
    const store = new PinRecordStore(fakeContext());
    const pm = new PinManager(store, sink(), () => picksDir);
    await pm.ensureStructure();
    const asset = buildAsset({ sourcePath: sourceFile });
    const record = await pm.pin(asset, buildToolkit());
    assert.ok(fs.existsSync(record.targetPath));
    await pm.unpin(asset.id);
    assert.equal(fs.existsSync(record.targetPath), false);
    assert.equal(store.list().length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('findPinRecord finds record by source id and by targetPath', async () => {
  const tmp = makeTempDir('pm-resolve');
  try {
    const sourceFile = path.join(tmp, 'a.agent.md');
    fs.writeFileSync(sourceFile, '# a');
    const picksDir = path.join(tmp, 'picks');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    await pm.ensureStructure();
    const asset = buildAsset({ sourcePath: sourceFile });
    const record = await pm.pin(asset, buildToolkit());

    // By asset id
    assert.ok(pm.findPinRecord(asset));

    // By targetPath (simulating asset rendered inside picks toolkit)
    const insidePicks = buildAsset({
      id: 'picks::agents/a.agent.md',
      sourcePath: record.targetPath,
    });
    const resolved = pm.findPinRecord(insidePicks);
    assert.ok(resolved);
    assert.equal(resolved.assetId, asset.id);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unpinAllFromToolkit removes all picks from that toolkit', async () => {
  const tmp = makeTempDir('pm-bulk');
  try {
    const tkDir = path.join(tmp, 'tk'); fs.mkdirSync(tkDir);
    const picksDir = path.join(tmp, 'picks');
    const store = new PinRecordStore(fakeContext());
    const pm = new PinManager(store, sink(), () => picksDir);
    await pm.ensureStructure();
    const tk = buildToolkit({ id: 'tkX', rootPath: tkDir });
    for (const name of ['a.agent.md', 'b.agent.md']) {
      const src = path.join(tkDir, name);
      fs.writeFileSync(src, '#');
      await pm.pin(buildAsset({ id: `tkX::${name}`, sourcePath: src }), tk);
    }
    assert.equal(store.list().length, 2);
    const n = await pm.unpinAllFromToolkit('tkX');
    assert.equal(n, 2);
    assert.equal(store.list().length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Groups ---

test('pin defaults to "default" group', async () => {
  const tmp = makeTempDir('groups-default');
  try {
    const src = path.join(tmp, 'a.agent.md');
    fs.writeFileSync(src, '#');
    const picksDir = path.join(tmp, 'picks');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    await pm.ensureStructure();
    const r = await pm.pin(buildAsset({ sourcePath: src }), buildToolkit());
    assert.equal(r.groupName, 'default');
    assert.ok(r.targetPath.includes(path.join('default', 'agents')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('pin with explicit group places asset in that group folder', async () => {
  const tmp = makeTempDir('groups-explicit');
  try {
    const src = path.join(tmp, 'a.agent.md');
    fs.writeFileSync(src, '#');
    const picksDir = path.join(tmp, 'picks');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    await pm.ensureStructure('web-dev');
    const r = await pm.pin(buildAsset({ sourcePath: src }), buildToolkit(), 'web-dev');
    assert.equal(r.groupName, 'web-dev');
    assert.ok(r.targetPath.includes(path.join('web-dev', 'agents')));
    assert.ok(fs.existsSync(r.targetPath));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('listGroups returns distinct group names', async () => {
  const tmp = makeTempDir('groups-list');
  try {
    const picksDir = path.join(tmp, 'picks');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    for (const g of ['web-dev', 'python', 'web-dev']) {
      await pm.ensureStructure(g);
      const src = path.join(tmp, g + '-source.agent.md');
      fs.writeFileSync(src, '#');
      await pm.pin(
        buildAsset({ id: `tk::${g}-asset`, sourcePath: src }),
        buildToolkit(),
        g
      );
    }
    const groups = await pm.listGroups();
    assert.deepEqual(groups, ['python', 'web-dev']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('moveToGroup relocates asset and updates record', async () => {
  const tmp = makeTempDir('groups-move');
  try {
    const src = path.join(tmp, 'a.agent.md');
    fs.writeFileSync(src, '#');
    const picksDir = path.join(tmp, 'picks');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    await pm.ensureStructure('from');
    const asset = buildAsset({ sourcePath: src });
    const r1 = await pm.pin(asset, buildToolkit(), 'from');
    assert.ok(fs.existsSync(r1.targetPath));
    const r2 = await pm.moveToGroup(asset.id, 'to');
    assert.equal(r2.groupName, 'to');
    assert.equal(fs.existsSync(r1.targetPath), false, 'old target removed');
    assert.ok(fs.existsSync(r2.targetPath), 'new target exists');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('deleteGroup removes picks and folder', async () => {
  const tmp = makeTempDir('groups-delete');
  try {
    const picksDir = path.join(tmp, 'picks');
    const store = new PinRecordStore(fakeContext());
    const pm = new PinManager(store, sink(), () => picksDir);
    await pm.ensureStructure('doomed');
    for (const name of ['a.agent.md', 'b.agent.md']) {
      const src = path.join(tmp, name);
      fs.writeFileSync(src, '#');
      await pm.pin(buildAsset({ id: `tk::${name}`, sourcePath: src }), buildToolkit(), 'doomed');
    }
    assert.equal(store.list().length, 2);
    const n = await pm.deleteGroup('doomed');
    assert.equal(n, 2);
    assert.equal(store.list().length, 0);
    assert.equal(fs.existsSync(path.join(picksDir, 'doomed')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('pinning same asset to different group moves it', async () => {
  const tmp = makeTempDir('groups-repin');
  try {
    const src = path.join(tmp, 'a.agent.md');
    fs.writeFileSync(src, '#');
    const picksDir = path.join(tmp, 'picks');
    const pm = new PinManager(new PinRecordStore(fakeContext()), sink(), () => picksDir);
    const asset = buildAsset({ sourcePath: src });
    const r1 = await pm.pin(asset, buildToolkit(), 'alpha');
    const r2 = await pm.pin(asset, buildToolkit(), 'beta');
    assert.equal(r2.groupName, 'beta');
    assert.equal(fs.existsSync(r1.targetPath), false);
    assert.ok(fs.existsSync(r2.targetPath));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('sanitizeGroupName strips junk', () => {
  const { sanitizeGroupName } = require('../out/picks.js');
  assert.equal(sanitizeGroupName('Web Dev!'), 'web-dev');
  assert.equal(sanitizeGroupName(''), 'default');
  assert.equal(sanitizeGroupName('  python  '), 'python');
  assert.equal(sanitizeGroupName('---x---'), 'x');
});

test('resync prunes picks with missing source', async () => {
  const tmp = makeTempDir('pm-prune');
  try {
    const sourceFile = path.join(tmp, 'vanishing.agent.md');
    fs.writeFileSync(sourceFile, '#');
    const picksDir = path.join(tmp, 'picks');
    const store = new PinRecordStore(fakeContext());
    const pm = new PinManager(store, sink(), () => picksDir);
    await pm.ensureStructure();
    const asset = buildAsset({ sourcePath: sourceFile });
    await pm.pin(asset, buildToolkit());

    fs.unlinkSync(sourceFile);
    const result = await pm.resync();
    assert.equal(result.pruned, 1);
    assert.equal(store.list().length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('PinManager.unpin refuses to delete targets outside pins dir', async () => {
  const dir = makeTempDir('containment');
  const outsideFile = path.join(dir, 'outside.txt');
  fs.writeFileSync(outsideFile, 'safe');
  const pinsDir = path.join(dir, 'pins');
  fs.mkdirSync(pinsDir, { recursive: true });

  const ctx = fakeContext();
  const store = new PinRecordStore(ctx);
  await store.add(rec({
    assetId: 'bad',
    targetPath: outsideFile,
  }));

  const pm = new PinManager(store, sink(), () => pinsDir);
  await pm.unpin('bad');
  // File outside pins dir must survive — containment prevented deletion
  assert.ok(fs.existsSync(outsideFile), 'File outside pins dir should not be deleted');
  // But the record should still be removed from the store
  assert.equal(store.isPinned('bad'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sanitizeGroupName rejects . and .. as group names', () => {
  const { sanitizeGroupName } = require('../out/picks.js');
  const { DEFAULT_PIN_GROUP } = require('../out/types.js');
  assert.equal(sanitizeGroupName('..'), DEFAULT_PIN_GROUP);
  assert.equal(sanitizeGroupName('.'), DEFAULT_PIN_GROUP);
  assert.equal(sanitizeGroupName('...'), DEFAULT_PIN_GROUP);
  assert.equal(sanitizeGroupName('valid.name'), 'valid.name');
  assert.equal(sanitizeGroupName('a..b'), 'a..b');
});
