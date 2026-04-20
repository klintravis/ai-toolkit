const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { GitToolkitManager, GitError, deriveRepoName, normalizeRemoteUrl, isValidRemoteUrl, redactCredentials } = require('../out/git.js');
const {
  gitAvailable, makeTempDir, createBareRepoWithCommit, addCommitToBare, cloneLocal, cleanup,
} = require('./helpers/gitFixtures.js');

const SKIP = !gitAvailable();

function sink() {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
}

// --- Pure helpers (no git needed) ---

test('deriveRepoName strips .git and takes last path segment', () => {
  assert.equal(deriveRepoName('https://github.com/user/my-repo.git'), 'my-repo');
  assert.equal(deriveRepoName('https://github.com/user/my-repo'), 'my-repo');
  assert.equal(deriveRepoName('git@github.com:user/my-repo.git'), 'my-repo');
  assert.equal(deriveRepoName('https://example.com/path/to/repo/'), 'repo');
});

test('normalizeRemoteUrl expands owner/repo shorthand', () => {
  assert.equal(normalizeRemoteUrl('github/awesome-copilot'), 'https://github.com/github/awesome-copilot');
  assert.equal(normalizeRemoteUrl('https://github.com/x/y'), 'https://github.com/x/y');
  assert.equal(normalizeRemoteUrl('  user/repo  '), 'https://github.com/user/repo');
});

test('isValidRemoteUrl accepts common forms', () => {
  assert.equal(isValidRemoteUrl('user/repo'), true);
  assert.equal(isValidRemoteUrl('https://github.com/user/repo.git'), true);
  assert.equal(isValidRemoteUrl('git@github.com:user/repo.git'), true);
  assert.equal(isValidRemoteUrl('ssh://git@host/path'), true);
  assert.equal(isValidRemoteUrl(''), false);
  assert.equal(isValidRemoteUrl('not a url'), false);
});

// --- Git-backed tests ---

test('checkGitAvailable returns a version string', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const v = await git.checkGitAvailable();
  assert.ok(v && v.includes('git'));
});

test('clone a local bare repo succeeds', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const { bareDir, workDir } = createBareRepoWithCommit();
  const parent = makeTempDir('clone-parent');
  try {
    const result = await git.clone({
      remoteUrl: bareDir,
      targetParentDir: parent,
      targetName: 'cloned',
    });
    assert.ok(result.sha.length > 0);
    assert.equal(result.branch, 'main');
    assert.ok(fs.existsSync(path.join(parent, 'cloned', '.git')));
  } finally {
    cleanup(bareDir, workDir, parent);
  }
});

test('clone into existing non-empty dir throws TARGET_EXISTS', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const { bareDir, workDir } = createBareRepoWithCommit();
  const parent = makeTempDir('clone-parent');
  const occupied = path.join(parent, 'cloned');
  fs.mkdirSync(occupied, { recursive: true });
  fs.writeFileSync(path.join(occupied, 'existing.txt'), 'hi');
  try {
    await assert.rejects(
      () => git.clone({ remoteUrl: bareDir, targetParentDir: parent, targetName: 'cloned' }),
      (err) => err instanceof GitError && err.code === 'TARGET_EXISTS'
    );
  } finally {
    cleanup(bareDir, workDir, parent);
  }
});

test('fetch reports behind count after remote commit', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const { bareDir, workDir } = createBareRepoWithCommit();
  const cloneDir = makeTempDir('clone-target');
  fs.rmSync(cloneDir, { recursive: true, force: true }); // cloneLocal recreates it
  try {
    cloneLocal(bareDir, cloneDir);
    // Initially up to date
    let result = await git.fetch(cloneDir);
    assert.equal(result.behind, 0);

    addCommitToBare(bareDir);

    result = await git.fetch(cloneDir);
    assert.equal(result.behind, 1);
    assert.equal(result.ahead, 0);
    assert.ok(result.remoteSha.length > 0);
  } finally {
    cleanup(bareDir, workDir, cloneDir);
  }
});

test('pull fast-forwards and updates sha', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const { bareDir, workDir } = createBareRepoWithCommit();
  const cloneDir = makeTempDir('clone-target');
  fs.rmSync(cloneDir, { recursive: true, force: true });
  try {
    cloneLocal(bareDir, cloneDir);
    const shaBefore = await git.getCurrentSha(cloneDir);
    addCommitToBare(bareDir);
    await git.fetch(cloneDir);
    const result = await git.pull(cloneDir);
    assert.equal(result.updated, true);
    assert.notEqual(result.sha, shaBefore);
  } finally {
    cleanup(bareDir, workDir, cloneDir);
  }
});

test('getRemoteUrl and isGitRepo work', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  const { bareDir, workDir } = createBareRepoWithCommit();
  const cloneDir = makeTempDir('clone-target');
  fs.rmSync(cloneDir, { recursive: true, force: true });
  try {
    cloneLocal(bareDir, cloneDir);
    assert.equal(await git.isGitRepo(cloneDir), true);
    assert.equal(await git.isGitRepo(makeTempDir('not-a-repo')), false);
    const url = await git.getRemoteUrl(cloneDir);
    assert.ok(url && url.length > 0);
  } finally {
    cleanup(bareDir, workDir, cloneDir);
  }
});

test('redactCredentials scrubs embedded tokens from URLs', () => {
  assert.equal(
    redactCredentials('Cloning into https://token:x-oauth@github.com/org/repo.git ...'),
    'Cloning into https://***:***@github.com/org/repo.git ...'
  );
  assert.equal(
    redactCredentials('fatal: could not read from http://user:pass@host/repo'),
    'fatal: could not read from http://***:***@host/repo'
  );
  assert.equal(redactCredentials('safe message with no urls'), 'safe message with no urls');
});

test('clone rejects .. as target name', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  await assert.rejects(
    () => git.clone({ remoteUrl: 'https://example.com/repo', targetParentDir: '/tmp', targetName: '..' }),
    { message: /Invalid target folder name/ }
  );
});
