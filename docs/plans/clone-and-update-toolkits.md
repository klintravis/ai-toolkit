# Plan: Clone & Update Toolkits from GitHub

## Objective

Let users clone toolkit repositories from GitHub directly inside the AI Toolkit
extension, then detect and apply updates to those cloned toolkits — without
leaving VS Code.

This plan is the authoritative implementation spec. Each step lists the files
to touch, the exact symbols to add/change, acceptance criteria, and test
coverage. Implementation should follow this plan in order; deviations should be
noted in commit messages.

---

## Scope

**In scope**

1. Clone a GitHub repository to a managed local directory and auto-register it
   as a toolkit path.
2. Track which toolkits were cloned (vs. user-added folders) and their remote
   URL + last-known commit SHA.
3. Detect available updates by running `git fetch` and comparing HEAD vs.
   `origin/HEAD`.
4. Show update availability in the tree view (badge/description).
5. One-click update per toolkit (`git pull --ff-only`) and "Update All".
6. Manual "Check for Updates" command and optional periodic background check.

**Out of scope**

- SSH key management / credential prompts beyond what `git` itself surfaces.
- Non-GitHub git providers (but URLs pointing at GitLab/Bitbucket should still
  work since we shell out to `git`; we just won't offer curated lists for them).
- Branch switching, detached HEADs, or conflict resolution UI. If an update
  cannot fast-forward, we surface the error and tell the user to resolve
  manually in a terminal.
- Un-cloning (deleting the folder). Removing the path from config leaves the
  folder on disk — explicit "Delete cloned folder" can come later.

---

## Architecture Overview

A new `GitToolkitManager` module wraps git operations. It is used by
`extension.ts` for clone/update commands and by a new `UpdateChecker` that
annotates `Toolkit` objects with update status.

```
extension.ts
  ├── GitToolkitManager        (git operations: clone, fetch, pull, status)
  ├── UpdateChecker            (batches git fetches, populates Toolkit.update)
  └── ClonedToolkitsStore      (persists { toolkitRoot → remote, lastSha })
          │
          └── writes to globalState (extension context) — not user settings
```

Key design decisions:

- **Shell out to `git`** via `child_process.spawn`. Rationale: zero new runtime
  deps, matches user's local git config (credentials, proxies, signing), and
  the VS Code Git extension API is overkill here since we only need
  clone/fetch/pull/rev-parse.
- **Storage**: cloned-toolkit metadata lives in
  `ExtensionContext.globalState`, NOT in `aiToolkit.*` settings. Settings are
  user-visible and user-editable; clone metadata is internal and keyed to
  machine-local paths.
- **Clone target**: default `~/.ai-toolkits/` (hidden to avoid cluttering
  `~`). Configurable via `aiToolkit.cloneDirectory`. Respects tilde paths.
- **Update model**: `Toolkit` gains an optional `update?: ToolkitUpdateStatus`
  field populated by `UpdateChecker`. The tree view reads this to render a
  badge. Scanner stays pure — it does NOT do git work.
- **Concurrency**: git operations per-toolkit are serialized via a simple
  in-flight map. Multiple toolkits fetch in parallel with a cap of 4.

---

## Data Model Changes

### `src/types.ts`

Add:

```typescript
/** Status of a cloned toolkit relative to its remote. */
export interface ToolkitUpdateStatus {
  /** True when remote has commits not present locally. */
  updateAvailable: boolean;
  /** Short SHA we are currently at (e.g. "a1b2c3d"). */
  currentSha: string;
  /** Short SHA available on remote, if known. */
  remoteSha?: string;
  /** Number of commits behind remote (undefined if not computed). */
  behindCount?: number;
  /** ISO timestamp of the last fetch/check. */
  lastCheckedAt: string;
  /** If the last check failed, the error message. */
  error?: string;
}

/** Persisted metadata about a git-cloned toolkit. */
export interface ClonedToolkitRecord {
  /** Absolute path to the clone directory (forward slashes). */
  rootPath: string;
  /** Git remote URL used when cloning. */
  remoteUrl: string;
  /** Branch that was cloned (usually "main"). */
  branch: string;
  /** SHA at time of clone/last successful pull. */
  lastKnownSha: string;
  /** ISO timestamp of clone. */
  clonedAt: string;
}
```

Extend `Toolkit`:

```typescript
export interface Toolkit {
  // ...existing fields...
  /** Populated by UpdateChecker after git fetch; undefined for non-cloned. */
  update?: ToolkitUpdateStatus;
  /** True when this toolkit was cloned via the extension. */
  isCloned?: boolean;
}
```

---

## New Modules

### `src/git.ts` — `GitToolkitManager`

Thin wrapper around `git` CLI. All methods return typed results; never throw
for "expected" git failures (missing remote, merge conflict). Throw only for
programming errors.

**Public API:**

```typescript
export class GitToolkitManager {
  constructor(private outputChannel: vscode.OutputChannel) {}

  /** Verify `git` is available on PATH. Returns version string or null. */
  async checkGitAvailable(): Promise<string | null>;

  /** Clone a repo. Returns { rootPath, branch, sha } or throws GitError. */
  async clone(opts: {
    remoteUrl: string;
    targetParentDir: string;
    targetName?: string;  // defaults to derived from URL
    branch?: string;      // defaults to remote HEAD
    depth?: number;       // defaults to undefined (full clone)
  }): Promise<{ rootPath: string; branch: string; sha: string }>;

  /** Run `git fetch` and return counts. */
  async fetch(rootPath: string): Promise<{ remoteSha: string; behind: number; ahead: number }>;

  /** Fast-forward pull. Returns new SHA. Throws GitError if non-ff. */
  async pull(rootPath: string): Promise<{ sha: string; updated: boolean }>;

  /** Get current HEAD SHA. */
  async getCurrentSha(rootPath: string): Promise<string>;

  /** Read remote URL from `git remote get-url origin`. */
  async getRemoteUrl(rootPath: string): Promise<string | null>;

  /** Detect if a path is a git working tree (has .git). */
  async isGitRepo(rootPath: string): Promise<boolean>;
}

export class GitError extends Error {
  constructor(public code: GitErrorCode, message: string, public stderr?: string) { super(message); }
}

export type GitErrorCode =
  | 'GIT_NOT_INSTALLED'
  | 'CLONE_FAILED'
  | 'FETCH_FAILED'
  | 'PULL_NOT_FAST_FORWARD'
  | 'PULL_FAILED'
  | 'NOT_A_REPO'
  | 'NETWORK_ERROR'
  | 'AUTH_REQUIRED';
```

**Implementation notes:**

- Use `child_process.spawn('git', args, { cwd })` with `shell: false`. Buffer
  stdout; stream stderr to `outputChannel` line-by-line with `[git] ` prefix.
- Apply a 5-minute timeout per command; kill the child and throw
  `NETWORK_ERROR` on timeout.
- Parse `git rev-list --left-right --count HEAD...origin/HEAD` for
  ahead/behind counts.
- Derive default clone target name from URL: strip `.git` suffix, take last
  path segment.
- Reject clone target if directory already exists and is non-empty.
- Surface `fatal: Authentication failed` stderr as `AUTH_REQUIRED` with a
  hint pointing at git credential helpers.

### `src/clonedToolkitsStore.ts` — `ClonedToolkitsStore`

Persists `ClonedToolkitRecord[]` in `ExtensionContext.globalState` under key
`aiToolkit.clonedToolkits`.

```typescript
export class ClonedToolkitsStore {
  constructor(private context: vscode.ExtensionContext) {}

  list(): ClonedToolkitRecord[];
  get(rootPath: string): ClonedToolkitRecord | undefined;
  add(record: ClonedToolkitRecord): Promise<void>;
  updateSha(rootPath: string, sha: string): Promise<void>;
  remove(rootPath: string): Promise<void>;

  /** True when the given toolkit rootPath was cloned by us. */
  isCloned(rootPath: string): boolean;
}
```

Path comparisons use `normalizeForComparison` from `pathUtils.ts`.

### `src/updateChecker.ts` — `UpdateChecker`

Orchestrates fetching update status for all cloned toolkits.

```typescript
export class UpdateChecker {
  constructor(
    private git: GitToolkitManager,
    private store: ClonedToolkitsStore,
    private outputChannel: vscode.OutputChannel
  ) {}

  /**
   * For each cloned toolkit, run `git fetch` and compute status.
   * Returns a map of rootPath → status. Does not mutate anything.
   * Runs with concurrency cap of 4.
   */
  async checkAll(clonedRoots: string[]): Promise<Map<string, ToolkitUpdateStatus>>;

  async checkOne(rootPath: string): Promise<ToolkitUpdateStatus>;
}
```

---

## Configuration Additions

### `package.json` — new settings

```json
"aiToolkit.cloneDirectory": {
  "type": "string",
  "default": "~/.ai-toolkits",
  "description": "Directory where AI Toolkit clones GitHub repositories. Supports ~/ tilde paths."
},
"aiToolkit.checkForUpdatesOnStartup": {
  "type": "boolean",
  "default": true,
  "description": "When enabled, check cloned toolkits for updates shortly after VS Code starts."
},
"aiToolkit.updateCheckIntervalMinutes": {
  "type": "number",
  "default": 0,
  "description": "Periodically check for toolkit updates at this interval (minutes). 0 disables periodic checks."
}
```

### `package.json` — new commands

```json
{ "command": "aiToolkit.cloneToolkit",     "title": "Clone Toolkit from GitHub…", "category": "AI Toolkit", "icon": "$(cloud-download)" },
{ "command": "aiToolkit.checkForUpdates",  "title": "Check for Toolkit Updates",  "category": "AI Toolkit", "icon": "$(sync)" },
{ "command": "aiToolkit.updateToolkit",    "title": "Update Toolkit",             "category": "AI Toolkit", "icon": "$(arrow-down)" },
{ "command": "aiToolkit.updateAllToolkits","title": "Update All Toolkits",        "category": "AI Toolkit" }
```

### `package.json` — menu wiring

- `aiToolkit.cloneToolkit` → `view/title` navigation group next to refresh.
- `aiToolkit.checkForUpdates` → `view/title` navigation group.
- `aiToolkit.updateToolkit` → `view/item/context` inline, `when: viewItem =~ /^toolkit-.*-updatable$/`.

---

## Tree View Changes

### Context value scheme

Current: `toolkit-enabled` | `toolkit-disabled`.

New: `toolkit-{enabled|disabled}-{cloned|external}[-updatable]`.

Examples:

- `toolkit-enabled-external`
- `toolkit-disabled-cloned`
- `toolkit-enabled-cloned-updatable`

This gives menu `when` clauses enough discrimination.

### Visuals

- Cloned toolkits get a `cloud` icon overlay (or the `cloud` theme icon) to
  distinguish from external folders.
- When `update.updateAvailable === true`:
  - Description becomes `update available` (replaces "enabled"/"disabled" — or
    appends, pending design: plan chooses **append** with " • update
    available").
  - Tooltip adds: `Update available: {currentSha}..{remoteSha} (N commits
    behind)`.
- On error: description appends " • check failed" and tooltip shows error.

---

## Command Flows

### `aiToolkit.cloneToolkit`

1. Call `git.checkGitAvailable()`. If null, show error "git is not installed
   or not on PATH" with a "Learn more" link → abort.
2. `vscode.window.showInputBox({ prompt: 'GitHub repo URL', validateInput })`.
   Validation: must be parseable as a git URL (https://, git@, or
   `owner/repo` shorthand → expand to `https://github.com/owner/repo`).
3. Derive suggested folder name; prompt `showInputBox` with prefilled value so
   users can override.
4. Resolve clone parent dir (`aiToolkit.cloneDirectory`, expand `~`).
   `fs.mkdir({ recursive: true })`.
5. Run `git.clone(...)` with `vscode.window.withProgress({ location:
   Notification, cancellable: true })`. Cancel token kills child.
6. On success:
   - `store.add(record)`.
   - Append `rootPath` to `aiToolkit.toolkitPaths` (dedup via
     `normalizeForComparison`).
   - Trigger `refreshToolkits()`.
   - Show info message with "Open Folder" action.
7. On failure: show error with stderr excerpt; offer "Show Log" action.

### `aiToolkit.checkForUpdates`

1. Read cloned toolkit roots from `store`.
2. Filter to roots that still exist on disk and are still in `toolkitPaths`.
3. Run `updateChecker.checkAll(roots)` under `withProgress`.
4. Annotate in-memory `allToolkits` with `.update` from the result map.
5. Refresh tree.
6. Status bar message: `"N toolkit update(s) available"` or `"All toolkits
   up to date"`.

### `aiToolkit.updateToolkit` (per-toolkit)

1. Arg = `{ toolkit: Toolkit }` from tree node.
2. If `!toolkit.isCloned` → show warning "Not a cloned toolkit" and abort.
3. `withProgress` → `git.pull(rootPath)`.
4. On success: `store.updateSha`, clear `toolkit.update`, trigger
   `refreshToolkits()` (scanner re-reads assets which may have changed).
5. On `PULL_NOT_FAST_FORWARD`: show error with "Open in Terminal" action that
   opens an integrated terminal in the toolkit root.

### `aiToolkit.updateAllToolkits`

Iterate toolkits where `update?.updateAvailable === true`; call
`updateToolkit` for each sequentially inside a single progress notification.

### Startup & periodic checks

In `activate()`:

- If `checkForUpdatesOnStartup` is true, schedule a deferred check via
  `setTimeout(() => checkForUpdates(), 10_000)` after initial refresh
  completes. (Don't block activation.)
- If `updateCheckIntervalMinutes > 0`, register a `setInterval` and track the
  handle in `context.subscriptions` (via a `Disposable` wrapper that calls
  `clearInterval`).
- React to `onDidChangeConfiguration` for the interval to reschedule.

---

## Integration Points in Existing Files

### `src/extension.ts`

- Instantiate `GitToolkitManager`, `ClonedToolkitsStore`, `UpdateChecker` in
  `activate()`. Pass `context` to the store.
- Register 4 new commands.
- After `doRefreshToolkits` completes, mark `toolkit.isCloned = store.isCloned(toolkit.rootPath)` for each toolkit.
- Add a module-level `updateStatusByRoot: Map<string, ToolkitUpdateStatus>`
  and apply it after each refresh so statuses survive re-scans.
- Wire startup/periodic update check.

### `src/treeProvider.ts`

- `getToolkitItem` reads `tk.update` and `tk.isCloned` to compute new
  `contextValue`, `description`, `tooltip`, and icon.
- No structural changes to the tree.

### `src/scanner.ts`

- **No changes required.** Scanner stays pure. Clone-awareness is layered on
  after scanning.

### `src/copilotSettings.ts`

- **No changes required.** Cloned toolkits are regular toolkit paths once
  registered.

---

## Error Handling & UX

| Scenario                         | Behavior                                                 |
|----------------------------------|----------------------------------------------------------|
| `git` not installed              | Block clone command; show install link. Updates silently skip. |
| Clone target already exists      | Error before starting clone. Offer to pick a different name. |
| Network failure during clone     | Remove partial clone dir; show error with retry option. |
| Clone cancelled via progress     | Remove partial clone dir.                                |
| Fetch fails for one toolkit      | Record error on `ToolkitUpdateStatus`; other toolkits continue. |
| Pull non-ff (user made changes)  | Show error + "Open in Terminal" action.                  |
| Repo removed from disk manually  | Skip during checks; emit warning to output channel.      |
| Remote URL changed out-of-band   | Detect mismatch with stored record; warn but still check. |

All git stderr is streamed to the `AI Toolkit` output channel, prefixed with
`[git]`.

---

## Testing Strategy

### New test files

1. **`test/git.test.js`** — unit tests for `GitToolkitManager`:
   - Mock via creating real local bare repos in `os.tmpdir()` and cloning
     them. No network required.
   - Test: `checkGitAvailable` returns a version string.
   - Test: `clone` of a local bare repo succeeds; returns correct sha/branch.
   - Test: `clone` into existing non-empty dir throws `CLONE_FAILED`.
   - Test: `fetch` reports behind count correctly after committing to bare
     repo.
   - Test: `pull` fast-forwards and updates sha.
   - Test: `pull` throws `PULL_NOT_FAST_FORWARD` when local has diverging
     commits.
   - Test: `getCurrentSha`, `getRemoteUrl`, `isGitRepo` basic behavior.
   - Skip the entire file gracefully if `git` is not on PATH (use
     `test.skip`).

2. **`test/clonedToolkitsStore.test.js`** — unit tests for store:
   - Use a fake `ExtensionContext` with in-memory `globalState`.
   - Test add/list/get/updateSha/remove/isCloned with path variations
     (forward/back slashes, case differences on Windows).

3. **`test/updateChecker.test.js`** — unit tests for checker:
   - Use real local bare repos (reuse helpers from `git.test.js`).
   - Test: `checkAll` returns status per toolkit; populates `updateAvailable`
     correctly.
   - Test: failing fetch on one repo does not abort others; error recorded
     in status.

### Test helpers

Add `test/helpers/gitFixtures.js`:

- `createBareRepo()` → path to a bare repo with one initial commit.
- `cloneLocal(bareRepoPath, targetDir)` → helper that uses `git` CLI to
  clone a bare repo (no extension code).
- `addCommitToBare(bareRepoPath)` → adds another commit so clones are behind.

### Update existing tests

None of the existing tests should need changes (scanner/pathUtils
unaffected). Confirm by running `npm run check` after each phase.

### `package.json` script update

```json
"test": "npm run compile && node --test test/pathUtils.test.js test/scanner.test.js test/git.test.js test/clonedToolkitsStore.test.js test/updateChecker.test.js"
```

---

## Implementation Phases

Each phase ends with `npm run check` passing.

### Phase 1 — Data model & store (no UI)

- Add `ToolkitUpdateStatus`, `ClonedToolkitRecord`, extend `Toolkit` in
  `types.ts`.
- Create `clonedToolkitsStore.ts`.
- Write `test/clonedToolkitsStore.test.js`.
- Verify compile + lint + tests.

### Phase 2 — Git wrapper

- Create `src/git.ts` with full `GitToolkitManager` + `GitError`.
- Write `test/helpers/gitFixtures.js` and `test/git.test.js`.
- Verify tests pass locally (skip gracefully if no git).

### Phase 3 — Update checker

- Create `src/updateChecker.ts`.
- Write `test/updateChecker.test.js`.
- Verify.

### Phase 4 — Commands & configuration

- Add 3 new settings and 4 new commands in `package.json`.
- Wire the commands in `extension.ts`:
  - `cloneToolkit`, `checkForUpdates`, `updateToolkit`, `updateAllToolkits`.
- Integrate store + checker into refresh flow: populate `isCloned` and
  `update` on toolkits before passing to tree provider.
- Manual test in Extension Host (F5).

### Phase 5 — Tree view polish

- Update `treeProvider.ts` `getToolkitItem` for context values, description,
  tooltip, icon.
- Update `view/item/context` menu wiring in `package.json`.
- Manual test in Extension Host.

### Phase 6 — Startup & periodic checks

- Wire `checkForUpdatesOnStartup` (10s delay after activation).
- Wire `updateCheckIntervalMinutes` with setInterval + config change
  reactivity.
- Manual test.

### Phase 7 — Documentation

- Update `CLAUDE.md`:
  - Add a paragraph under "Project" about clone/update.
  - Add new module references under "Architecture".
  - Note the `globalState` storage decision under "Key Design Decisions".
- Update `README.md` (if present) with the new commands. If no README
  exists, skip.

---

## Acceptance Criteria

A human running `npm run check` followed by `F5` in the Extension Host should
be able to:

1. Run **AI Toolkit: Clone Toolkit from GitHub…**, paste
   `https://github.com/github/awesome-copilot`, and see it appear in the tree
   after cloning completes.
2. See a cloud icon / "cloned" indicator distinguishing it from a manually
   added folder.
3. Run **AI Toolkit: Check for Toolkit Updates** and see "All toolkits up to
   date" (assuming just cloned).
4. After a remote commit happens, re-running the check shows " • update
   available" on the toolkit.
5. Right-click the toolkit and choose **Update Toolkit** to pull — tree
   refreshes and the badge clears.
6. Running **Update All Toolkits** pulls every updatable cloned toolkit.
7. Restarting VS Code triggers a background update check after ~10s without
   blocking other activation work.
8. Removing the toolkit path via **Remove Toolkit Folder** also cleans up its
   record from `ClonedToolkitsStore`.
9. Existing features (enable/disable, add path, Copilot discovery) continue
   working unchanged.

Automated tests cover the git wrapper, store, and update checker in
isolation. UI flows are manually verified per the phase checklists.

---

## Open Questions / Deferred Items

- **Shallow clones**: depth=1 is faster but complicates updates. Plan uses
  full clones; a `shallowClone` toggle can come later.
- **SSH URLs**: supported passively (we just shell to git) but we do not
  prompt for SSH key setup.
- **Delete cloned folder on remove**: currently only removes the
  registration. A follow-up command can wipe the folder after confirmation.
- **Submodules**: not handled. Deferred.
- **Branch switching**: deferred. Current branch is whatever was cloned.
