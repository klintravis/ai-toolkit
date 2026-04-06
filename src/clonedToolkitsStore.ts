import { normalizeForComparison } from './pathUtils';
import { ClonedToolkitRecord, GlobalStateContext } from './types';

const STORAGE_KEY = 'aiToolkit.clonedToolkits';

/**
 * Persists metadata about git-cloned toolkits in ExtensionContext.globalState.
 */
export class ClonedToolkitsStore {
  private cache: ClonedToolkitRecord[] | null = null;

  constructor(private context: GlobalStateContext) {}

  list(): ClonedToolkitRecord[] {
    if (this.cache === null) {
      const raw = this.context.globalState.get<ClonedToolkitRecord[]>(STORAGE_KEY);
      this.cache = Array.isArray(raw)
        ? raw.filter(r => r && typeof r === 'object' && typeof r.rootPath === 'string' && typeof r.remoteUrl === 'string')
        : [];
    }
    return this.cache;
  }

  get(rootPath: string): ClonedToolkitRecord | undefined {
    const target = normalizeForComparison(rootPath);
    return this.list().find(r => normalizeForComparison(r.rootPath) === target);
  }

  isCloned(rootPath: string): boolean {
    return this.get(rootPath) !== undefined;
  }

  async add(record: ClonedToolkitRecord): Promise<void> {
    const target = normalizeForComparison(record.rootPath);
    const next = this.list().filter(r => normalizeForComparison(r.rootPath) !== target);
    next.push(record);
    this.cache = next;
    await this.context.globalState.update(STORAGE_KEY, next);
  }

  async updateSha(rootPath: string, sha: string): Promise<void> {
    const target = normalizeForComparison(rootPath);
    const next = this.list().map(r =>
      normalizeForComparison(r.rootPath) === target ? { ...r, lastKnownSha: sha } : r
    );
    this.cache = next;
    await this.context.globalState.update(STORAGE_KEY, next);
  }

  async remove(rootPath: string): Promise<void> {
    const target = normalizeForComparison(rootPath);
    const next = this.list().filter(r => normalizeForComparison(r.rootPath) !== target);
    this.cache = next;
    await this.context.globalState.update(STORAGE_KEY, next);
  }
}
