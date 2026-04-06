const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { GitToolkitManager } = require('../out/git.js');
const { UpdateChecker } = require('../out/updateChecker.js');
const {
  gitAvailable, makeTempDir, createBareRepoWithCommit, addCommitToBare, cloneLocal, cleanup,
} = require('./helpers/gitFixtures.js');

const SKIP = !gitAvailable();

function sink() { return { appendLine: () => {} }; }

test('checkOne returns no update when up to date', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const checker = new UpdateChecker(git, sink());
  const { bareDir, workDir } = createBareRepoWithCommit();
  const cloneDir = makeTempDir('uc-target');
  fs.rmSync(cloneDir, { recursive: true, force: true });
  try {
    cloneLocal(bareDir, cloneDir);
    const status = await checker.checkOne(cloneDir);
    assert.equal(status.updateAvailable, false);
    assert.equal(status.behindCount, 0);
    assert.ok(status.currentSha.length > 0);
    assert.equal(status.error, undefined);
  } finally {
    cleanup(bareDir, workDir, cloneDir);
  }
});

test('checkOne detects available update after remote commit', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const checker = new UpdateChecker(git, sink());
  const { bareDir, workDir } = createBareRepoWithCommit();
  const cloneDir = makeTempDir('uc-target');
  fs.rmSync(cloneDir, { recursive: true, force: true });
  try {
    cloneLocal(bareDir, cloneDir);
    addCommitToBare(bareDir);
    const status = await checker.checkOne(cloneDir);
    assert.equal(status.updateAvailable, true);
    assert.equal(status.behindCount, 1);
    assert.ok(status.remoteSha);
  } finally {
    cleanup(bareDir, workDir, cloneDir);
  }
});

test('checkOne records error for non-repo path without throwing', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const checker = new UpdateChecker(git, sink());
  const notARepo = makeTempDir('not-a-repo');
  try {
    const status = await checker.checkOne(notARepo);
    assert.equal(status.updateAvailable, false);
    assert.ok(status.error);
  } finally {
    cleanup(notARepo);
  }
});

test('checkAll processes multiple repos; failing one does not abort others', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const checker = new UpdateChecker(git, sink(), 2);
  const { bareDir: bare1, workDir: work1 } = createBareRepoWithCommit();
  const { bareDir: bare2, workDir: work2 } = createBareRepoWithCommit();
  const clone1 = makeTempDir('uc-a'); fs.rmSync(clone1, { recursive: true, force: true });
  const clone2 = makeTempDir('uc-b'); fs.rmSync(clone2, { recursive: true, force: true });
  const bogus = makeTempDir('uc-bogus'); // not a repo
  try {
    cloneLocal(bare1, clone1);
    cloneLocal(bare2, clone2);
    addCommitToBare(bare2);

    const results = await checker.checkAll([clone1, clone2, bogus]);
    assert.equal(results.size, 3);
    assert.equal(results.get(clone1).updateAvailable, false);
    assert.equal(results.get(clone2).updateAvailable, true);
    assert.ok(results.get(bogus).error);
  } finally {
    cleanup(bare1, work1, bare2, work2, clone1, clone2, bogus);
  }
});
