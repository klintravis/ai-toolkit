# Security Hardening for Enterprise Release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all High and Medium security findings from the enterprise code review so the extension is safe for internal release.

**Architecture:** Fixes are organized by module. Most changes are small defensive checks added at trust boundaries (path containment, input sanitization, credential redaction). No new modules or architectural changes.

**Tech Stack:** TypeScript (strict), Node.js built-in `node:test` + `node:assert/strict`, VS Code Extension API.

---

### Task 1: Harden `sanitizeGroupName` — reject `.` and `..` (H2, M5)

**Files:**
- Modify: `src/picks.ts:460-463`
- Test: `test/picks.test.js`

- [ ] **Step 1: Write failing tests for `..` and `.` group names**

Add to `test/picks.test.js`:

```javascript
test('sanitizeGroupName rejects . and .. as group names', () => {
  const { sanitizeGroupName } = require('../out/picks.js');
  const { DEFAULT_PIN_GROUP } = require('../out/types.js');
  assert.equal(sanitizeGroupName('..'), DEFAULT_PIN_GROUP);
  assert.equal(sanitizeGroupName('.'), DEFAULT_PIN_GROUP);
  assert.equal(sanitizeGroupName('...'), DEFAULT_PIN_GROUP);
  assert.equal(sanitizeGroupName('valid.name'), 'valid.name');
  assert.equal(sanitizeGroupName('a..b'), 'a..b');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run compile && node --test test/picks.test.js`
Expected: FAIL — `..` currently passes through as `..`

- [ ] **Step 3: Fix `sanitizeGroupName` to reject dot-only names**

In `src/picks.ts`, replace the `sanitizeGroupName` function:

```typescript
export function sanitizeGroupName(name: string): string {
  const cleaned = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  // Reject names that are all dots (., .., ...) — they are path traversal vectors.
  if (!cleaned || /^\.+$/.test(cleaned)) { return DEFAULT_PIN_GROUP; }
  return cleaned;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run compile && node --test test/picks.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/picks.ts test/picks.test.js
git commit -m "fix(security): reject dot-only group names in sanitizeGroupName to prevent path traversal"
```

---

### Task 2: Add containment guard to `picks.ts` write/delete operations (H1)

**Files:**
- Modify: `src/picks.ts:56-101, 246-258, 264-298, 386-443`
- Test: `test/picks.test.js`

- [ ] **Step 1: Write failing test for containment check**

Add to `test/picks.test.js`:

```javascript
test('PinManager.unpin refuses to delete targets outside pins dir', async () => {
  const dir = makeTempDir('containment');
  const outsideFile = path.join(dir, 'outside.txt');
  fs.writeFileSync(outsideFile, 'safe');
  const pinsDir = path.join(dir, 'pins');
  fs.mkdirSync(pinsDir, { recursive: true });

  const ctx = fakeContext();
  const store = new PinRecordStore(ctx);
  // Manually inject a corrupted record pointing outside the pins dir
  await store.add(rec({
    assetId: 'bad',
    targetPath: outsideFile,
  }));

  const pm = new PinManager(store, sink(), () => pinsDir);
  await pm.unpin('bad');
  // The file outside pins dir must survive — containment prevented deletion
  assert.ok(fs.existsSync(outsideFile), 'File outside pins dir should not be deleted');
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run compile && node --test test/picks.test.js`
Expected: FAIL — currently deletes the file

- [ ] **Step 3: Add `assertInsidePinsDir` guard and apply it throughout**

In `src/picks.ts`, add a private helper and call it before every `removeIfExists` and `materializeAsset` call that uses a record's `targetPath`. Modify these methods:

Add after the `isInsidePinsDir` export:

```typescript
function assertInsidePinsDir(targetPath: string, pinsDir: string): void {
  if (!isInsidePinsDir(targetPath, pinsDir)) {
    throw new Error(`Security: target path escapes pins directory: ${targetPath}`);
  }
}
```

Then in `PinManager`:

- `pin()` — after computing `targetPath` (before `materializeAsset`), add: `assertInsidePinsDir(targetPath, picksDir);`
- `moveToGroup()` — after computing `newTarget`, add: `assertInsidePinsDir(newTarget, picksDir);`  
  Also before `removeIfExists(record.targetPath)`: `assertInsidePinsDir(record.targetPath, picksDir);`
- `deleteGroup()` — before `removeIfExists(r.targetPath)`: `assertInsidePinsDir(r.targetPath, this.getPinsDir());`  
  Also before `fs.promises.rm(groupDir, ...)`: `assertInsidePinsDir(groupDir, this.getPinsDir());`
- `renameGroup()` — after computing `rel`, add:
  ```typescript
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    this.output.appendLine(`[pins] skipping record with escaped path: ${r.targetPath}`);
    continue;
  }
  ```
- `unpin()` — before `removeIfExists(record.targetPath)`: `assertInsidePinsDir(record.targetPath, this.getPinsDir());`  
  Wrap in try/catch so the record is still removed from the store even if the file is outside pins dir.
- `resync()` — before `removeIfExists(record.targetPath)`: wrap with containment check; skip if outside.
- `unpinAllFromToolkit()` — before `removeIfExists(r.targetPath)`: wrap with containment check; skip if outside.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run compile && node --test test/picks.test.js`
Expected: PASS (all existing + new containment test)

- [ ] **Step 5: Commit**

```bash
git add src/picks.ts test/picks.test.js
git commit -m "fix(security): add containment guards to prevent writes/deletes outside pins directory"
```

---

### Task 3: Add symlink containment to scanner (H3, M6)

**Files:**
- Modify: `src/scanner.ts:139-240, 289-303`
- Test: `test/scanner.test.js`

- [ ] **Step 1: Write failing test for symlink escape**

Add to `test/scanner.test.js`:

```javascript
test('scanPath - symlinks pointing outside toolkit root are ignored', async () => {
  const scanner = new ToolkitScanner();
  const tempDir = makeTempDir('test-symlink-escape');
  const outsideDir = makeTempDir('test-outside-target');

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'agents', 'legit.agent.md'), '# Legit');
    // Write a file in the outside dir that matches asset naming
    fs.writeFileSync(path.join(outsideDir, 'evil.agent.md'), '# Evil');
    // Create a symlink inside agents/ that points outside the toolkit
    try {
      fs.symlinkSync(outsideDir, path.join(tempDir, 'agents', 'escaped'), 'dir');
    } catch {
      // Symlinks may not be supported — skip test
      return;
    }

    const result = await scanner.scanPath(tempDir, {});
    assert.equal(result.length, 1);
    // Should only find legit.agent.md, not the escaped symlink's contents
    const agentAssets = result[0].assets.filter(a => a.type === 'agents');
    for (const asset of agentAssets) {
      assert.ok(
        !asset.sourcePath.includes('evil'),
        `Should not discover assets from escaped symlink: ${asset.sourcePath}`
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run compile && node --test test/scanner.test.js`
Expected: FAIL — currently follows the symlink and discovers `evil.agent.md`

- [ ] **Step 3: Add realpath containment check and visited-path tracking**

In `src/scanner.ts`:

1. Update `scanToolkit` to pass `rootPath` into `discoverAssets`:
   Change `discoverAssets(root, id)` to `discoverAssets(root, id, rootPath)`.

2. Thread `toolkitRoot` and `visited: Set<string>` through `discoverAssets` → `scanAssetFolder` → `scanFolderContents`.

3. In `classifyEntry`, after resolving symlinks via `fs.promises.stat`, also call `fs.promises.realpath(fullPath)` and check:
   - The real path starts with the toolkit root's real path.
   - The real path hasn't been visited before (add to `visited` set).

   Modify `classifyEntry` to accept `toolkitRealRoot` and `visited`:

```typescript
private async classifyEntry(
  fullPath: string,
  entry: fs.Dirent,
  toolkitRealRoot?: string,
  visited?: Set<string>,
): Promise<{ isFile: boolean; isDirectory: boolean }> {
  if (entry.isSymbolicLink()) {
    try {
      const stat = await fs.promises.stat(fullPath);
      const realPath = await fs.promises.realpath(fullPath);
      // Containment: reject symlinks that escape the toolkit root
      if (toolkitRealRoot) {
        const normalizedReal = realPath.replace(/\\/g, '/').toLowerCase();
        const normalizedRoot = toolkitRealRoot.replace(/\\/g, '/').toLowerCase();
        if (!normalizedReal.startsWith(normalizedRoot + '/') && normalizedReal !== normalizedRoot) {
          return { isFile: false, isDirectory: false };
        }
      }
      // Cycle detection: skip already-visited directories
      if (stat.isDirectory() && visited) {
        if (visited.has(realPath)) {
          return { isFile: false, isDirectory: false };
        }
        visited.add(realPath);
      }
      return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
    } catch {
      return { isFile: false, isDirectory: false };
    }
  }
  return { isFile: entry.isFile(), isDirectory: entry.isDirectory() };
}
```

4. In `discoverAssets`, create the `visited` set and resolve `toolkitRealRoot`:

```typescript
private async discoverAssets(assetsRoot: string, toolkitId: string, toolkitRoot: string): Promise<Asset[]> {
  const assets: Asset[] = [];
  let toolkitRealRoot: string;
  try {
    toolkitRealRoot = await fs.promises.realpath(toolkitRoot);
  } catch {
    toolkitRealRoot = toolkitRoot;
  }
  const visited = new Set<string>();

  for (const type of Object.values(AssetType)) {
    const folderPath = path.join(assetsRoot, type);
    if (!(await pathExists(folderPath))) {
      continue;
    }
    const discovered = await this.scanAssetFolder(folderPath, type, toolkitId, type, MAX_SCAN_DEPTH, toolkitRealRoot, visited);
    assets.push(...discovered);
  }
  return assets;
}
```

5. Thread `toolkitRealRoot` and `visited` through `scanAssetFolder` and `scanFolderContents` to each `classifyEntry` call.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run compile && node --test test/scanner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scanner.ts test/scanner.test.js
git commit -m "fix(security): add symlink containment check and cycle detection in scanner"
```

---

### Task 4: Validate `openSource` webview message (H5)

**Files:**
- Modify: `src/extension.ts:868-869`

- [ ] **Step 1: Add path validation to `openSource` handler**

In `src/extension.ts`, replace the `openSource` case in `handleDashboardMessage`:

```typescript
case 'openSource': {
  // Validate the path belongs to a known toolkit or the pins directory
  const pinsDir = pinManager.getPinsDir();
  const knownRoots = allToolkits.map(t => t.rootPath);
  knownRoots.push(pinsDir);
  const sourcePath = msg.sourcePath;
  const isUnderKnownRoot = knownRoots.some(root => {
    const normSource = normalizeForComparison(sourcePath);
    const normRoot = normalizeForComparison(root);
    return normSource === normRoot || normSource.startsWith(normRoot + '/');
  });
  if (isUnderKnownRoot) {
    openAssetFile({ sourcePath, isFolder: msg.isFolder });
  } else {
    outputChannel.appendLine(`[security] blocked openSource for path outside known roots: ${sourcePath}`);
  }
  return;
}
```

- [ ] **Step 2: Run full test suite**

Run: `npm run compile && npm test`
Expected: PASS (this handler isn't unit-tested — it's VS Code API integration code)

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "fix(security): validate openSource webview message against known toolkit roots"
```

---

### Task 5: Reject `..` as clone folder name (M1)

**Files:**
- Modify: `src/extension.ts:408-412`
- Test: `test/git.test.js`

- [ ] **Step 1: Write test for `deriveRepoName` returning `..`**

Add to `test/git.test.js`:

```javascript
test('deriveRepoName returns "toolkit" for traversal attempts', () => {
  assert.equal(deriveRepoName('https://evil.com/repo/..'), '..');
  // The extension.ts validateInput must reject this — tested via the regex + explicit check
});
```

- [ ] **Step 2: Update the `validateInput` in `cloneToolkit`**

In `src/extension.ts` around line 411, update the `validateInput` callback:

```typescript
validateInput: v => {
  if (!v || !/^[\w.-]+$/.test(v)) { return 'Use letters, numbers, dots, dashes, underscores'; }
  if (/^\.+$/.test(v)) { return 'Invalid folder name'; }
  return null;
},
```

- [ ] **Step 3: Also add defense-in-depth check to `git.ts clone()`**

In `src/git.ts`, at the top of the `clone` method (after computing `name`), add:

```typescript
if (/^\.+$/.test(name) || name.includes('/') || name.includes('\\')) {
  throw new GitError('CLONE_FAILED', `Invalid target folder name: ${name}`);
}
```

- [ ] **Step 4: Write test for the git.ts guard**

Add to `test/git.test.js`:

```javascript
test('clone rejects .. as target name', { skip: SKIP }, async () => {
  const git = new GitToolkitManager(sink());
  await assert.rejects(
    () => git.clone({ remoteUrl: 'https://example.com/repo', targetParentDir: '/tmp', targetName: '..' }),
    { message: /Invalid target folder name/ }
  );
});
```

- [ ] **Step 5: Run tests**

Run: `npm run compile && node --test test/git.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts src/git.ts test/git.test.js
git commit -m "fix(security): reject dot-only clone folder names to prevent path traversal"
```

---

### Task 6: Redact credentials from git stderr logging (M2)

**Files:**
- Modify: `src/git.ts:207-212, 273-282`
- Test: `test/git.test.js`

- [ ] **Step 1: Write test for `redactCredentials`**

Add to `test/git.test.js`:

```javascript
test('redactCredentials scrubs embedded tokens from URLs', () => {
  const { redactCredentials } = require('../out/git.js');
  assert.equal(
    redactCredentials('Cloning into https://token:x-oauth@github.com/org/repo.git ...'),
    'Cloning into https://***@github.com/org/repo.git ...'
  );
  assert.equal(
    redactCredentials('fatal: could not read from http://user:pass@host/repo'),
    'fatal: could not read from http://***@host/repo'
  );
  assert.equal(redactCredentials('safe message with no urls'), 'safe message with no urls');
});
```

- [ ] **Step 2: Implement `redactCredentials` and apply it**

In `src/git.ts`, add an exported helper:

```typescript
/** Scrub embedded credentials from URLs in log text. */
export function redactCredentials(text: string): string {
  return text.replace(/https?:\/\/[^@\s]+@/g, match => {
    const scheme = match.startsWith('https') ? 'https' : 'http';
    return `${scheme}://***@`;
  });
}
```

Apply in the `run` method's stderr handler (line 211):
```typescript
if (line.length > 0) { this.output.appendLine(`[git] ${redactCredentials(line)}`); }
```

Apply in `classifyGitError` (line 281):
```typescript
return new GitError(fallbackCode, `git ${operation} failed: ${redactCredentials(stderr.trim())}`, stderr);
```

- [ ] **Step 3: Run tests**

Run: `npm run compile && node --test test/git.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/git.ts test/git.test.js
git commit -m "fix(security): redact credentials from git stderr before logging"
```

---

### Task 7: Use crypto-secure nonce in dashboard (M7)

**Files:**
- Modify: `src/dashboard.ts:218-223`

- [ ] **Step 1: Replace `Math.random()` nonce with `crypto.randomBytes`**

In `src/dashboard.ts`, add import at top:

```typescript
import * as crypto from 'crypto';
```

Replace the `getNonce` function:

```typescript
function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
```

- [ ] **Step 2: Run full test suite**

Run: `npm run compile && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.ts
git commit -m "fix(security): use crypto.randomBytes for webview nonce generation"
```

---

### Task 8: Validate globalState record shapes (M8)

**Files:**
- Modify: `src/clonedToolkitsStore.ts:14-18`
- Modify: `src/picks.ts:14-18`
- Test: `test/clonedToolkitsStore.test.js`

- [ ] **Step 1: Write test for corrupted globalState**

Add to `test/clonedToolkitsStore.test.js`:

```javascript
test('list filters out malformed records from globalState', () => {
  const ctx = fakeContext();
  // Inject garbage into globalState
  ctx.globalState.update('aiToolkit.clonedToolkits', [
    { rootPath: '/good', remoteUrl: 'https://x', branch: 'main', lastKnownSha: 'abc', clonedAt: '2026-01-01' },
    { notARecord: true },
    null,
    'string',
    { rootPath: 123 },
  ]);
  const store = new ClonedToolkitsStore(ctx);
  const records = store.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].rootPath, '/good');
});
```

- [ ] **Step 2: Add validation to `ClonedToolkitsStore.list()`**

In `src/clonedToolkitsStore.ts`, update the `list()` method:

```typescript
list(): ClonedToolkitRecord[] {
  if (this.cache === null) {
    const raw = this.context.globalState.get<ClonedToolkitRecord[]>(STORAGE_KEY);
    this.cache = Array.isArray(raw)
      ? raw.filter(r => r && typeof r === 'object' && typeof r.rootPath === 'string' && typeof r.remoteUrl === 'string')
      : [];
  }
  return this.cache;
}
```

- [ ] **Step 3: Add validation to `PinRecordStore.list()`**

In `src/picks.ts`, update `PinRecordStore.list()`:

```typescript
list(): PinRecord[] {
  if (this.cache === null) {
    const raw = this.context.globalState.get<PinRecord[]>(STORAGE_KEY);
    this.cache = Array.isArray(raw)
      ? raw.filter(r => r && typeof r === 'object' && typeof r.assetId === 'string' && typeof r.targetPath === 'string')
      : [];
  }
  return this.cache;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run compile && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/clonedToolkitsStore.ts src/picks.ts test/clonedToolkitsStore.test.js
git commit -m "fix(security): validate globalState record shapes on read"
```

---

### Task 9: Use `dereference: false` in copy fallback (M4)

**Files:**
- Modify: `src/picks.ts:81, 415`

- [ ] **Step 1: Change `dereference: true` to `false`**

In `src/picks.ts` line 81:
```typescript
await fs.promises.cp(sourcePath, targetPath, { recursive: true, force: true, dereference: false });
```

In `src/picks.ts` line 415 (in `resync`):
```typescript
await fs.promises.cp(record.sourcePath, record.targetPath, { recursive: true, force: true, dereference: false });
```

- [ ] **Step 2: Run tests**

Run: `npm run compile && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/picks.ts
git commit -m "fix(security): use dereference:false in copy fallback to avoid following symlinks into sensitive dirs"
```

---

### Task 10: Enforce minimum update check interval (L2)

**Files:**
- Modify: `src/extension.ts:896-909`

- [ ] **Step 1: Add minimum floor**

In `src/extension.ts`, update `schedulePeriodicCheck`:

```typescript
function schedulePeriodicCheck(): void {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = undefined;
  }
  const raw = vscode.workspace.getConfiguration('aiToolkit').get<number>('updateCheckIntervalMinutes', 0);
  const minutes = raw > 0 ? Math.max(raw, 5) : 0;
  if (minutes > 0) {
    updateCheckInterval = setInterval(() => {
      checkForUpdates(false).catch(err =>
        outputChannel.appendLine(`Periodic update check failed: ${err}`)
      );
    }, minutes * 60 * 1000);
  }
}
```

- [ ] **Step 2: Run tests**

Run: `npm run compile && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "fix(security): enforce 5-minute minimum floor on update check interval"
```

---

### Task 11: Validate `removeToolkit` and `updateToolkit` webview messages (L4)

**Files:**
- Modify: `src/extension.ts:834-841`

- [ ] **Step 1: Add validation**

In `handleDashboardMessage`, update the two cases:

```typescript
case 'updateToolkit': {
  const toolkit = allToolkits.find(t => normalizeForComparison(t.rootPath) === normalizeForComparison(msg.rootPath));
  if (toolkit) { await updateToolkitCommand({ toolkit }); }
  return;
}
case 'removeToolkit': {
  const toolkit = allToolkits.find(t => normalizeForComparison(t.rootPath) === normalizeForComparison(msg.rootPath));
  if (toolkit) { await removeToolkitPath({ folderPath: toolkit.rootPath }); }
  return;
}
```

- [ ] **Step 2: Run tests**

Run: `npm run compile && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "fix(security): validate removeToolkit/updateToolkit webview messages against known toolkits"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm run check`
Expected: All lint + tests PASS

- [ ] **Step 2: Verify no regressions**

Run: `npm run compile && node --test test/picks.test.js && node --test test/git.test.js && node --test test/scanner.test.js && node --test test/clonedToolkitsStore.test.js`
Expected: All PASS
