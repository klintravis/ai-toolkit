const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** True if git is on PATH. */
function gitAvailable() {
  try {
    const res = spawnSync('git', ['--version'], { encoding: 'utf8' });
    return res.status === 0;
  } catch {
    return false;
  }
}

function makeTempDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runGit(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

/** Create a bare repo with one initial commit. Returns the bare repo path. */
function createBareRepoWithCommit() {
  // 1) Create a working repo with a commit
  const workDir = makeTempDir('git-work');
  runGit(['init', '-b', 'main'], workDir);
  runGit(['config', 'user.email', 'test@example.com'], workDir);
  runGit(['config', 'user.name', 'Test'], workDir);
  runGit(['config', 'commit.gpgsign', 'false'], workDir);
  fs.writeFileSync(path.join(workDir, 'README.md'), '# initial\n');
  runGit(['add', '.'], workDir);
  runGit(['commit', '-m', 'initial'], workDir);

  // 2) Clone --bare
  const bareDir = makeTempDir('git-bare') + '.git';
  runGit(['clone', '--bare', workDir, bareDir], process.cwd());

  return { bareDir, workDir };
}

/** Add a new commit to a bare repo via a temp clone. Returns new SHA. */
function addCommitToBare(bareDir) {
  const scratch = makeTempDir('git-scratch');
  runGit(['clone', bareDir, scratch], process.cwd());
  runGit(['config', 'user.email', 'test@example.com'], scratch);
  runGit(['config', 'user.name', 'Test'], scratch);
  runGit(['config', 'commit.gpgsign', 'false'], scratch);
  const file = path.join(scratch, `file-${Date.now()}.txt`);
  fs.writeFileSync(file, 'new content\n');
  runGit(['add', '.'], scratch);
  runGit(['commit', '-m', 'update'], scratch);
  runGit(['push', 'origin', 'main'], scratch);
  const sha = runGit(['rev-parse', 'HEAD'], scratch);
  fs.rmSync(scratch, { recursive: true, force: true });
  return sha;
}

/** Clone a bare repo to targetDir (bypasses extension code). */
function cloneLocal(bareDir, targetDir) {
  runGit(['clone', bareDir, targetDir], process.cwd());
  // Quiet down any commit hooks / signing
  runGit(['config', 'user.email', 'test@example.com'], targetDir);
  runGit(['config', 'user.name', 'Test'], targetDir);
  runGit(['config', 'commit.gpgsign', 'false'], targetDir);
}

function cleanup(...dirs) {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = {
  gitAvailable,
  makeTempDir,
  runGit,
  createBareRepoWithCommit,
  addCommitToBare,
  cloneLocal,
  cleanup,
};
