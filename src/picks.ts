import * as fs from 'fs';
import * as path from 'path';
import { expandHomePath, normalizeForComparison, pathExists } from './pathUtils';
import { Asset, AssetType, DEFAULT_PIN_GROUP, GlobalStateContext, OutputLog, PinRecord, Toolkit } from './types';

const STORAGE_KEY = 'aiToolkit.pickedAssets';


export class PinRecordStore {
  private cache: PinRecord[] | null = null;

  constructor(private context: GlobalStateContext) {}

  list(): PinRecord[] {
    if (this.cache === null) {
      const raw = this.context.globalState.get<PinRecord[]>(STORAGE_KEY);
      this.cache = Array.isArray(raw) ? raw : [];
    }
    return this.cache;
  }

  get(assetId: string): PinRecord | undefined {
    return this.list().find(r => r.assetId === assetId);
  }

  isPinned(assetId: string): boolean {
    return this.get(assetId) !== undefined;
  }

  async add(record: PinRecord): Promise<void> {
    const next = this.list().filter(r => r.assetId !== record.assetId);
    next.push(record);
    this.cache = next;
    await this.context.globalState.update(STORAGE_KEY, next);
  }

  async remove(assetId: string): Promise<void> {
    const next = this.list().filter(r => r.assetId !== assetId);
    this.cache = next;
    await this.context.globalState.update(STORAGE_KEY, next);
  }

  async targetInUse(targetPath: string, excludeAssetId?: string): Promise<boolean> {
    const target = normalizeForComparison(targetPath);
    return this.list().some(r =>
      r.assetId !== excludeAssetId && normalizeForComparison(r.targetPath) === target
    );
  }
}


/**
 * Creates a symlink if supported, falling back to junction (for directories
 * on Windows) or full copy. Returns the kind actually used.
 */
export async function materializeAsset(
  sourcePath: string,
  targetPath: string,
  isFolder: boolean
): Promise<'symlink' | 'junction' | 'copy'> {
  // Remove existing target first so re-pinning works cleanly.
  await removeIfExists(targetPath);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  // Try symlink first (works on Unix and on Windows with Dev Mode / admin)
  try {
    const type = isFolder && process.platform === 'win32' ? 'junction' : (isFolder ? 'dir' : 'file');
    await fs.promises.symlink(sourcePath, targetPath, type);
    return type === 'junction' ? 'junction' : 'symlink';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') {
      throw err;
    }
  }

  // Fallback: copy. For dirs on Windows, fall back to copy if junction also failed
  // (unlikely since junctions don't need admin, but handled for safety).
  if (isFolder) {
    // cp recursive (Node 16.7+)
    await fs.promises.cp(sourcePath, targetPath, { recursive: true, force: true, dereference: true });
  } else {
    await fs.promises.copyFile(sourcePath, targetPath);
  }
  return 'copy';
}

async function removeIfExists(p: string): Promise<void> {
  try {
    const stat = await fs.promises.lstat(p);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await fs.promises.rm(p, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(p);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

export class PinManager {
  constructor(
    private store: PinRecordStore,
    private output: OutputLog,
    private getPinsDirSetting: () => string,
  ) {}

  getPinsDir(): string {
    return path.resolve(expandHomePath(this.getPinsDirSetting()));
  }

  isPinsToolkit(toolkit: Toolkit): boolean {
    return normalizeForComparison(toolkit.rootPath) === normalizeForComparison(this.getPinsDir());
  }

  isPinned(assetId: string): boolean {
    return this.store.isPinned(assetId);
  }

  listPinRecords(): PinRecord[] {
    return this.store.list();
  }

  /**
   * Resolve the PinRecord for an asset — matching by the original asset id,
   * or, for assets surfaced inside the picks toolkit, by sourcePath matching
   * the record's targetPath.
   */
  findPinRecord(asset: Asset): PinRecord | undefined {
    const byId = this.store.get(asset.id);
    if (byId) { return byId; }
    const sourceNorm = normalizeForComparison(asset.sourcePath);
    return this.store.list().find(r => normalizeForComparison(r.targetPath) === sourceNorm);
  }

  /**
   * Pin an asset: create link/copy under <picksDir>/<group>/<type>/ and record it.
   * Resolves name collisions by appending the source toolkit slug.
   */
  async pin(asset: Asset, toolkit: Toolkit, groupName: string = DEFAULT_PIN_GROUP): Promise<PinRecord> {
    if (this.isPinsToolkit(toolkit)) {
      throw new Error('Cannot pin assets from the picks toolkit itself.');
    }
    const group = sanitizeGroupName(groupName);
    const existing = this.store.get(asset.id);
    if (existing) {
      // Asset is already pinned — if group matches, return as-is. Otherwise move.
      if (existing.groupName === group) { return existing; }
      return this.moveToGroup(asset.id, group);
    }

    const picksDir = this.getPinsDir();
    const typeDir = path.join(picksDir, group, asset.type);
    await fs.promises.mkdir(typeDir, { recursive: true });

    // Derive target filename. Use source basename by default; if collision
    // within this group, prefix with slugified source toolkit name.
    const baseName = path.basename(asset.sourcePath);
    let targetPath = path.join(typeDir, baseName);
    if (await this.store.targetInUse(targetPath)) {
      const slug = slugify(toolkit.name);
      targetPath = path.join(typeDir, `${slug}__${baseName}`);
    }

    const linkType = await materializeAsset(asset.sourcePath, targetPath, asset.isFolder);

    const record: PinRecord = {
      assetId: asset.id,
      groupName: group,
      toolkitId: toolkit.id,
      toolkitName: toolkit.name,
      assetType: asset.type,
      assetName: asset.name,
      sourcePath: asset.sourcePath,
      targetPath,
      linkType,
      isFolder: asset.isFolder,
      pinnedAt: new Date().toISOString(),
    };
    await this.store.add(record);
    this.output.appendLine(`[pins] pinned ${asset.name} to group "${group}" (${linkType}) → ${targetPath}`);
    return record;
  }

  /**
   * List all distinct group names: unions groups that contain picks
   * (from the store) with on-disk group folders (so empty groups still
   * appear). Always sorted. Asset-type names are excluded — they are
   * reserved subfolders inside a group, never group names themselves.
   */
  async listGroups(): Promise<string[]> {
    const assetTypeNames = new Set<string>(Object.values(AssetType));
    const set = new Set<string>();
    for (const r of this.store.list()) { set.add(r.groupName); }
    try {
      const entries = await fs.promises.readdir(this.getPinsDir(), { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) { continue; }
        // Skip asset-type names (legacy artifacts from pre-group layout).
        if (assetTypeNames.has(e.name)) { continue; }
        set.add(e.name);
      }
    } catch { /* picksDir may not exist yet */ }
    return [...set].sort();
  }

  /** Picks belonging to a specific group. */
  listPinsInGroup(groupName: string): PinRecord[] {
    return this.store.list().filter(r => r.groupName === groupName);
  }

  /**
   * Move an existing pick to a different group. Recreates the link/copy
   * under the new group path and removes the old target.
   */
  async moveToGroup(assetId: string, newGroup: string): Promise<PinRecord> {
    const record = this.store.get(assetId);
    if (!record) { throw new Error(`Not pinned: ${assetId}`); }
    const group = sanitizeGroupName(newGroup);
    if (record.groupName === group) { return record; }

    const picksDir = this.getPinsDir();
    const typeDir = path.join(picksDir, group, record.assetType);
    await fs.promises.mkdir(typeDir, { recursive: true });
    const baseName = path.basename(record.targetPath);
    let newTarget = path.join(typeDir, baseName);
    if (await this.store.targetInUse(newTarget, assetId)) {
      newTarget = path.join(typeDir, `${slugify(record.toolkitName)}__${baseName}`);
    }

    const linkType = await materializeAsset(record.sourcePath, newTarget, record.isFolder);
    await removeIfExists(record.targetPath);

    const updated: PinRecord = { ...record, groupName: group, targetPath: newTarget, linkType };
    await this.store.add(updated);
    this.output.appendLine(`[pins] moved ${record.assetName} to group "${group}"`);
    return updated;
  }

  /**
   * Delete an entire group: remove all its picks (and on-disk folder).
   * Returns number of picks removed.
   */
  async deleteGroup(groupName: string): Promise<number> {
    const group = sanitizeGroupName(groupName);
    const pinsToRemove = this.listPinsInGroup(group);
    for (const r of pinsToRemove) {
      await removeIfExists(r.targetPath);
      await this.store.remove(r.assetId);
    }
    // Remove the group folder (including any empty type subfolders).
    const groupDir = path.join(this.getPinsDir(), group);
    try { await fs.promises.rm(groupDir, { recursive: true, force: true }); } catch { /* ignore */ }
    this.output.appendLine(`[pins] deleted group "${group}" (${pinsToRemove.length} picks)`);
    return pinsToRemove.length;
  }

  /**
   * Rename a group: atomic folder rename + updates all record targetPaths
   * in one shot. Works for empty groups too.
   */
  async renameGroup(oldName: string, newName: string): Promise<number> {
    const oldGroup = sanitizeGroupName(oldName);
    const newGroup = sanitizeGroupName(newName);
    if (oldGroup === newGroup) { return 0; }
    const picksDir = this.getPinsDir();
    const oldDir = path.join(picksDir, oldGroup);
    const newDir = path.join(picksDir, newGroup);

    // Ensure destination doesn't already exist.
    if (await pathExists(newDir)) {
      throw new Error(`Group "${newGroup}" already exists.`);
    }

    // Rename the folder if it exists on disk (handles empty groups).
    if (await pathExists(oldDir)) {
      await fs.promises.mkdir(path.dirname(newDir), { recursive: true });
      try {
        await fs.promises.rename(oldDir, newDir);
      } catch (err) {
        // Fallback: copy then remove (cross-device or similar edge cases).
        await fs.promises.cp(oldDir, newDir, { recursive: true });
        await fs.promises.rm(oldDir, { recursive: true, force: true });
      }
    }

    // Update records: compute relative path from old group dir and re-root under new.
    const picks = this.listPinsInGroup(oldGroup);
    for (const r of picks) {
      const rel = path.relative(oldDir, r.targetPath);
      const newTarget = path.join(newDir, rel);
      await this.store.add({ ...r, groupName: newGroup, targetPath: newTarget });
    }
    this.output.appendLine(`[pins] renamed group "${oldGroup}" → "${newGroup}" (${picks.length} pick(s))`);
    return picks.length;
  }

  /**
   * Remove stray asset-type folders sitting at the picks root (artifacts
   * from the pre-group layout). Any remaining files inside are moved into
   * the default group before the old folder is deleted.
   */
  async cleanupLegacyAssetTypeFolders(): Promise<number> {
    const picksDir = this.getPinsDir();
    let cleaned = 0;
    for (const type of Object.values(AssetType)) {
      const legacyDir = path.join(picksDir, type);
      if (!(await pathExists(legacyDir))) { continue; }
      const destDir = path.join(picksDir, DEFAULT_PIN_GROUP, type);
      let hadChildren = false;
      try {
        const entries = await fs.promises.readdir(legacyDir, { withFileTypes: true });
        for (const e of entries) {
          hadChildren = true;
          const src = path.join(legacyDir, e.name);
          const dest = path.join(destDir, e.name);
          await fs.promises.mkdir(destDir, { recursive: true });
          // Remove any existing file at dest so rename succeeds.
          await removeIfExists(dest);
          try {
            await fs.promises.rename(src, dest);
          } catch {
            // Cross-device fallback
            if (e.isDirectory() || e.isSymbolicLink()) {
              await fs.promises.cp(src, dest, { recursive: true, dereference: false });
            } else {
              await fs.promises.copyFile(src, dest);
            }
            await removeIfExists(src);
          }
        }
      } catch (err) {
        this.output.appendLine(`[pins] cleanup read failed for ${legacyDir}: ${err}`);
        continue;
      }
      try {
        await fs.promises.rm(legacyDir, { recursive: true, force: true });
        if (hadChildren) {
          this.output.appendLine(`[pins] migrated legacy ${type}/ folder into "${DEFAULT_PIN_GROUP}" group`);
          cleaned++;
        }
      } catch { /* ignore */ }
    }
    return cleaned;
  }

  /**
   * Migrate legacy picks (flat layout: picksDir/<type>/<file>) into the
   * default group (picksDir/default/<type>/<file>). Safe to call repeatedly.
   * Returns number of records migrated.
   */
  async migrateLegacyLayout(): Promise<number> {
    let migrated = 0;
    const picksDir = normalizeForComparison(this.getPinsDir());
    for (const record of this.store.list()) {
      // Legacy records don't have groupName. TS now requires it, so fall back
      // to presence of "default" segment in the target path.
      const hasGroup = !!(record as PinRecord).groupName;
      const targetNorm = normalizeForComparison(record.targetPath);
      // If path is <picksDir>/<type>/file (no group segment), migrate.
      const rel = targetNorm.startsWith(picksDir + '/') ? targetNorm.slice(picksDir.length + 1) : '';
      const parts = rel.split('/');
      // After migration: parts[0] === 'default' (or another group name), parts[1] === assetType, parts[2] === filename
      // Legacy: parts[0] === assetType, parts[1] === filename
      if (parts.length === 2 && !hasGroup) {
        try {
          const updated = await this.moveToGroup(record.assetId, DEFAULT_PIN_GROUP);
          // moveToGroup assumed groupName was set; backfill for legacy:
          if (!updated.groupName) { updated.groupName = DEFAULT_PIN_GROUP; await this.store.add(updated); }
          migrated++;
        } catch (err) {
          this.output.appendLine(`[pins] migration failed for ${record.assetName}: ${err}`);
        }
      } else if (!hasGroup) {
        // Path already has a group segment (somehow) but record lacks field — backfill.
        const backfilled: PinRecord = { ...record, groupName: parts[0] || DEFAULT_PIN_GROUP };
        await this.store.add(backfilled);
        migrated++;
      }
    }
    return migrated;
  }

  async unpin(assetId: string): Promise<void> {
    const record = this.store.get(assetId);
    if (!record) { return; }
    await removeIfExists(record.targetPath);
    await this.store.remove(assetId);
    this.output.appendLine(`[pins] unpinned ${record.assetName}`);
  }

  /**
   * Resync: for `copy`-type picks, re-copy from source so content stays
   * fresh after source updates. Symlinks/junctions don't need resyncing.
   * Also prunes picks whose source has gone missing.
   */
  async resync(): Promise<{ refreshed: number; pruned: number }> {
    let refreshed = 0;
    let pruned = 0;
    for (const record of this.store.list()) {
      const sourceExists = await pathExists(record.sourcePath);
      if (!sourceExists) {
        await removeIfExists(record.targetPath);
        await this.store.remove(record.assetId);
        this.output.appendLine(`[pins] pruned missing source: ${record.assetName}`);
        pruned++;
        continue;
      }
      if (record.linkType === 'copy') {
        try {
          await removeIfExists(record.targetPath);
          if (record.isFolder) {
            await fs.promises.cp(record.sourcePath, record.targetPath, { recursive: true, force: true, dereference: true });
          } else {
            await fs.promises.mkdir(path.dirname(record.targetPath), { recursive: true });
            await fs.promises.copyFile(record.sourcePath, record.targetPath);
          }
          refreshed++;
        } catch (err) {
          this.output.appendLine(`[pins] failed to refresh ${record.assetName}: ${err}`);
        }
      }
    }
    return { refreshed, pruned };
  }

  /**
   * Bulk-unpin every asset originating from the given toolkit id. Called
   * when the toolkit is being removed so orphaned links don't linger.
   */
  async unpinAllFromToolkit(toolkitId: string): Promise<number> {
    const pinsToRemove = this.store.list().filter(r => r.toolkitId === toolkitId);
    for (const r of pinsToRemove) {
      await removeIfExists(r.targetPath);
      await this.store.remove(r.assetId);
    }
    if (pinsToRemove.length > 0) {
      this.output.appendLine(`[pins] unpinned ${pinsToRemove.length} asset(s) from toolkit ${toolkitId}`);
    }
    return pinsToRemove.length;
  }

  async ensureStructure(groupName: string = DEFAULT_PIN_GROUP): Promise<void> {
    const group = sanitizeGroupName(groupName);
    const groupDir = path.join(this.getPinsDir(), group);
    await fs.promises.mkdir(groupDir, { recursive: true });
    for (const type of Object.values(AssetType)) {
      await fs.promises.mkdir(path.join(groupDir, type), { recursive: true });
    }
  }

  getGroupDir(groupName: string): string {
    return path.join(this.getPinsDir(), sanitizeGroupName(groupName));
  }
}

/** Validate & normalize a group name: letters, numbers, dashes, underscores. */
export function sanitizeGroupName(name: string): string {
  const cleaned = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  // Reject names that are all dots (., .., ...) — they are path traversal vectors.
  if (!cleaned || /^\.+$/.test(cleaned)) { return DEFAULT_PIN_GROUP; }
  return cleaned;
}

// --- helpers ---

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'toolkit';
}

/** True when the given path is inside (or equal to) a picks directory. */
export function isInsidePinsDir(targetPath: string, picksDir: string): boolean {
  const t = normalizeForComparison(targetPath);
  const p = normalizeForComparison(picksDir);
  return t === p || t.startsWith(p + '/');
}
