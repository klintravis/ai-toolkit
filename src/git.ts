import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathExists } from './pathUtils';

export type GitErrorCode =
  | 'GIT_NOT_INSTALLED'
  | 'CLONE_FAILED'
  | 'FETCH_FAILED'
  | 'PULL_NOT_FAST_FORWARD'
  | 'PULL_FAILED'
  | 'NOT_A_REPO'
  | 'NETWORK_ERROR'
  | 'AUTH_REQUIRED'
  | 'TARGET_EXISTS';

export class GitError extends Error {
  constructor(public code: GitErrorCode, message: string, public stderr?: string) {
    super(message);
    this.name = 'GitError';
  }
}

import { OutputLog } from './types';

/** Options for running a single git command. */
interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Thin wrapper around the `git` CLI for cloning, fetching, and updating
 * toolkit repositories. Shell-out via `spawn` with `shell: false` so
 * arguments are never interpolated into a shell string.
 */
export class GitToolkitManager {
  constructor(private output: OutputLog) {}

  /** Verify `git` is on PATH. Returns version string or null. */
  async checkGitAvailable(): Promise<string | null> {
    try {
      const res = await this.run(['--version'], { timeoutMs: 10_000 });
      if (res.exitCode === 0) {
        return res.stdout.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Clone a repo into targetParentDir/targetName (or derived name).
   * Throws GitError on failure; partial clone directory is cleaned up.
   */
  async clone(opts: {
    remoteUrl: string;
    targetParentDir: string;
    targetName?: string;
    branch?: string;
    depth?: number;
    signal?: AbortSignal;
  }): Promise<{ rootPath: string; branch: string; sha: string }> {
    const name = opts.targetName ?? deriveRepoName(opts.remoteUrl);
    if (/^\.+$/.test(name) || name.includes('/') || name.includes('\\')) {
      throw new GitError('CLONE_FAILED', `Invalid target folder name: ${name}`);
    }
    const rootPath = path.join(opts.targetParentDir, name);

    if (await pathExists(rootPath)) {
      const entries = await fs.promises.readdir(rootPath).catch(() => []);
      if (entries.length > 0) {
        throw new GitError('TARGET_EXISTS', `Target directory already exists and is not empty: ${rootPath}`);
      }
    }

    await fs.promises.mkdir(opts.targetParentDir, { recursive: true });

    const args = ['clone'];
    if (opts.branch) { args.push('--branch', opts.branch); }
    if (opts.depth && opts.depth > 0) { args.push('--depth', String(opts.depth)); }
    args.push('--', opts.remoteUrl, rootPath);

    let res: RunResult;
    try {
      res = await this.run(args, { signal: opts.signal });
    } catch (err) {
      await removeDir(rootPath);
      throw err;
    }

    if (res.exitCode !== 0) {
      await removeDir(rootPath);
      throw classifyGitError('clone', res.stderr);
    }

    const sha = await this.getCurrentSha(rootPath);
    const branch = await this.getCurrentBranch(rootPath);
    return { rootPath, branch, sha };
  }

  /** Fetch remote and return ahead/behind counts vs origin/HEAD. */
  async fetch(rootPath: string): Promise<{ remoteSha: string; behind: number; ahead: number }> {
    const fetchRes = await this.run(['fetch', '--prune', 'origin'], { cwd: rootPath });
    if (fetchRes.exitCode !== 0) {
      throw classifyGitError('fetch', fetchRes.stderr);
    }

    // rev-list --left-right --count HEAD...origin/HEAD → "<ahead>\t<behind>"
    const counts = await this.run(
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      { cwd: rootPath }
    );

    let ahead = 0;
    let behind = 0;
    if (counts.exitCode === 0) {
      const parts = counts.stdout.trim().split(/\s+/);
      if (parts.length === 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    }

    const remoteShaRes = await this.run(['rev-parse', '--short', '@{upstream}'], { cwd: rootPath });
    const remoteSha = remoteShaRes.exitCode === 0 ? remoteShaRes.stdout.trim() : '';

    return { remoteSha, behind, ahead };
  }

  /** Fast-forward pull. Throws GitError('PULL_NOT_FAST_FORWARD') if impossible. */
  async pull(rootPath: string): Promise<{ sha: string; updated: boolean }> {
    const beforeSha = await this.getCurrentSha(rootPath);
    const res = await this.run(['pull', '--ff-only'], { cwd: rootPath });
    if (res.exitCode !== 0) {
      if (/non-fast-forward|not possible to fast-forward|diverge/i.test(res.stderr)) {
        throw new GitError('PULL_NOT_FAST_FORWARD', 'Cannot fast-forward; local branch has diverged.', res.stderr);
      }
      throw new GitError('PULL_FAILED', `git pull failed: ${res.stderr.trim()}`, res.stderr);
    }
    const afterSha = await this.getCurrentSha(rootPath);
    return { sha: afterSha, updated: beforeSha !== afterSha };
  }

  async getCurrentSha(rootPath: string): Promise<string> {
    const res = await this.run(['rev-parse', '--short', 'HEAD'], { cwd: rootPath });
    if (res.exitCode !== 0) {
      throw new GitError('NOT_A_REPO', `Not a git repository: ${rootPath}`, res.stderr);
    }
    return res.stdout.trim();
  }

  async getCurrentBranch(rootPath: string): Promise<string> {
    const res = await this.run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootPath });
    if (res.exitCode !== 0) {
      throw new GitError('NOT_A_REPO', `Not a git repository: ${rootPath}`, res.stderr);
    }
    return res.stdout.trim();
  }

  async getRemoteUrl(rootPath: string): Promise<string | null> {
    const res = await this.run(['remote', 'get-url', 'origin'], { cwd: rootPath });
    if (res.exitCode !== 0) {
      return null;
    }
    return res.stdout.trim();
  }

  async isGitRepo(rootPath: string): Promise<boolean> {
    const gitDir = path.join(rootPath, '.git');
    try {
      const stat = await fs.promises.stat(gitDir);
      return stat.isDirectory() || stat.isFile(); // .git may be a file in worktrees
    } catch {
      return false;
    }
  }

  // --- internals ---

  private run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: opts.cwd, shell: false });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      const onAbort = () => { child.kill('SIGKILL'); };
      if (opts.signal) {
        if (opts.signal.aborted) { child.kill('SIGKILL'); }
        else { opts.signal.addEventListener('abort', onAbort, { once: true }); }
      }

      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.length > 0) { this.output.appendLine(`[git] ${line}`); }
        }
      });

      child.on('error', err => {
        clearTimeout(timeout);
        if (opts.signal) { opts.signal.removeEventListener('abort', onAbort); }
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new GitError('GIT_NOT_INSTALLED', 'git executable not found on PATH'));
          return;
        }
        reject(err);
      });

      child.on('close', code => {
        clearTimeout(timeout);
        if (opts.signal) { opts.signal.removeEventListener('abort', onAbort); }
        if (timedOut) {
          reject(new GitError('NETWORK_ERROR', `git ${args[0]} timed out`, stderr));
          return;
        }
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }
}

// --- helpers ---

export function deriveRepoName(remoteUrl: string): string {
  let name = remoteUrl.trim();
  // Strip trailing slash and .git suffix
  name = name.replace(/\/+$/, '');
  name = name.replace(/\.git$/i, '');
  // Take last path segment
  const lastSep = Math.max(name.lastIndexOf('/'), name.lastIndexOf(':'));
  if (lastSep >= 0) { name = name.slice(lastSep + 1); }
  // Fallback
  return name || 'toolkit';
}

/** Expand owner/repo shorthand into https://github.com/owner/repo. */
export function normalizeRemoteUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }
  return trimmed;
}

export function isValidRemoteUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) { return false; }
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) { return true; }
  if (/^https?:\/\/\S+/i.test(trimmed)) { return true; }
  if (/^git@[\w.-]+:\S+/i.test(trimmed)) { return true; }
  if (/^ssh:\/\/\S+/i.test(trimmed)) { return true; }
  if (/^git:\/\/\S+/i.test(trimmed)) { return true; }
  return false;
}

/** Classify a git error from stderr into a typed GitError. */
function classifyGitError(operation: 'clone' | 'fetch', stderr: string): GitError {
  if (/Authentication failed|could not read Username|Permission denied/i.test(stderr)) {
    return new GitError('AUTH_REQUIRED', `Authentication required for ${operation}.`, stderr);
  }
  if (/Could not resolve host|Connection timed out|Failed to connect/i.test(stderr)) {
    return new GitError('NETWORK_ERROR', `Network error during ${operation}.`, stderr);
  }
  const fallbackCode: GitErrorCode = operation === 'clone' ? 'CLONE_FAILED' : 'FETCH_FAILED';
  return new GitError(fallbackCode, `git ${operation} failed: ${stderr.trim()}`, stderr);
}

async function removeDir(p: string): Promise<void> {
  try { await fs.promises.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
}
