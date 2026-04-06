const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClonedToolkitsStore } = require('../out/clonedToolkitsStore.js');

/** Create a fake ExtensionContext with in-memory globalState. */
function fakeContext() {
  const store = new Map();
  return {
    globalState: {
      get(key) { return store.get(key); },
      update(key, value) { store.set(key, value); return Promise.resolve(); },
    },
  };
}

function record(rootPath, overrides = {}) {
  return {
    rootPath,
    remoteUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    lastKnownSha: 'abc1234',
    clonedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('list returns empty array when nothing stored', () => {
  const store = new ClonedToolkitsStore(fakeContext());
  assert.deepEqual(store.list(), []);
});

test('add then list returns the record', async () => {
  const store = new ClonedToolkitsStore(fakeContext());
  await store.add(record('/home/user/toolkits/a'));
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].rootPath, '/home/user/toolkits/a');
});

test('add with duplicate path replaces existing record', async () => {
  const store = new ClonedToolkitsStore(fakeContext());
  await store.add(record('/home/user/toolkits/a', { lastKnownSha: 'aaa1111' }));
  await store.add(record('/home/user/toolkits/a', { lastKnownSha: 'bbb2222' }));
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].lastKnownSha, 'bbb2222');
});

test('get returns record for matching path', async () => {
  const store = new ClonedToolkitsStore(fakeContext());
  await store.add(record('/home/user/toolkits/a'));
  assert.ok(store.get('/home/user/toolkits/a'));
  assert.equal(store.get('/home/user/toolkits/missing'), undefined);
});

test('isCloned returns true for stored path', async () => {
  const store = new ClonedToolkitsStore(fakeContext());
  await store.add(record('/home/user/toolkits/a'));
  assert.equal(store.isCloned('/home/user/toolkits/a'), true);
  assert.equal(store.isCloned('/home/user/toolkits/b'), false);
});

test('updateSha updates only the targeted record', async () => {
  const store = new ClonedToolkitsStore(fakeContext());
  await store.add(record('/home/user/toolkits/a', { lastKnownSha: 'aaa1111' }));
  await store.add(record('/home/user/toolkits/b', { lastKnownSha: 'bbb2222' }));
  await store.updateSha('/home/user/toolkits/a', 'ccc3333');
  assert.equal(store.get('/home/user/toolkits/a').lastKnownSha, 'ccc3333');
  assert.equal(store.get('/home/user/toolkits/b').lastKnownSha, 'bbb2222');
});

test('remove deletes the record', async () => {
  const store = new ClonedToolkitsStore(fakeContext());
  await store.add(record('/home/user/toolkits/a'));
  await store.add(record('/home/user/toolkits/b'));
  await store.remove('/home/user/toolkits/a');
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].rootPath, '/home/user/toolkits/b');
});

test('path comparison normalizes slashes and case on Windows', async () => {
  const store = new ClonedToolkitsStore(fakeContext());
  await store.add(record('C:/Users/me/toolkits/Kit'));
  if (process.platform === 'win32') {
    assert.ok(store.isCloned('c:\\users\\me\\toolkits\\kit'));
    assert.ok(store.get('C:\\Users\\me\\toolkits\\Kit'));
  } else {
    // On non-Windows, just verify the exact path matches
    assert.ok(store.isCloned('C:/Users/me/toolkits/Kit'));
  }
});
