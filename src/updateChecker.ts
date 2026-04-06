import { GitError, GitToolkitManager } from './git';
import { OutputLog, ToolkitUpdateStatus } from './types';

const DEFAULT_CONCURRENCY = 4;

/**
 * Checks cloned toolkits against their remotes by running `git fetch`
 * and comparing HEAD to origin.
 */
export class UpdateChecker {
  constructor(
    private git: GitToolkitManager,
    private output: OutputLog,
    private concurrency: number = DEFAULT_CONCURRENCY,
  ) {}

  /** Check a single toolkit root. Never throws — errors go into the status. */
  async checkOne(rootPath: string): Promise<ToolkitUpdateStatus> {
    const now = new Date().toISOString();
    try {
      const currentSha = await this.git.getCurrentSha(rootPath);
      const fetchResult = await this.git.fetch(rootPath);
      return {
        updateAvailable: fetchResult.behind > 0,
        currentSha,
        remoteSha: fetchResult.remoteSha || undefined,
        behindCount: fetchResult.behind,
        lastCheckedAt: now,
      };
    } catch (err) {
      const message = err instanceof GitError ? err.message : String(err);
      this.output.appendLine(`[update-check] ${rootPath}: ${message}`);
      return {
        updateAvailable: false,
        currentSha: '',
        lastCheckedAt: now,
        error: message,
      };
    }
  }

  /** Check multiple roots with bounded concurrency. */
  async checkAll(rootPaths: string[]): Promise<Map<string, ToolkitUpdateStatus>> {
    const results = new Map<string, ToolkitUpdateStatus>();
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < rootPaths.length) {
        const i = index++;
        const root = rootPaths[i];
        const status = await this.checkOne(root);
        results.set(root, status);
      }
    };

    const workers: Promise<void>[] = [];
    const count = Math.min(this.concurrency, rootPaths.length);
    for (let i = 0; i < count; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }
}
