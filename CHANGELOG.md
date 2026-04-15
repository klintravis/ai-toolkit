# Changelog

All notable changes to the AI Toolkit VS Code extension.

## [0.3.0] — 2026-04-15

### Added
- Sideloaded Claude Code plugin folders (folders containing `.claude-plugin/plugin.json`) are now discovered as first-class toolkits with a dedicated Plugins section in the tree view.
- Flat-layout toolkit detection: folders containing `agents/`, `instructions/`, `skills/`, `prompts/`, `hooks/`, or `commands/` at the root are discovered as sideloaded toolkits.
- Legacy `.github/`-rooted toolkits are re-supported via the flat-layout detection path.
- Baseline unit test coverage for `extension.ts`, `copilotSettings.ts`, `treeProvider.ts`, and `dashboard.ts`.

### Changed
- Dashboard no longer loads fonts from `fonts.googleapis.com` — uses VS Code's native font stack for offline-safety and privacy.
- Credential redaction now applies at every user-facing error surface, not only inside `git.ts`.
- `plugin.json` manifest reads are cached per `applyToolkits` call to avoid duplicate I/O on the hot path.
- `MAX_SCAN_DEPTH` documented as a symlink-loop DoS guard.

### Removed
- Dead `aiToolkit.openPickSource` command registration.
- Stale `out/activeTreeProvider.js` orphan artifact.
- Source maps and `.d.ts` files from the published `.vsix` (dev debugging unaffected).
- `scripts/` dev-only folder from the published `.vsix`.

### Fixed
- Startup update-check timer now cleared in `deactivate()` (no more disposed-channel warnings on rapid close).
- "Add to Workspace" / "Remove from Workspace" menu items no longer appear on pin groups.
- Sideloaded skill platform classification is now `'both'`, matching flat-layout behavior.
- Folder-based skills in the tree view are once again clickable to expand and show their markdown children.
- `cloneToolkit` rejects path-traversal in the configured clone directory with a clear error.

## [0.2.1] — 2026-03-xx

### Fixed
- Wrap `npx` with `cmd /c` for Windows MCP server compatibility.

## [0.2.0] — 2026-03-xx

### Added
- Security hardening pass: path-escape guards, credential redaction in git logs, `shell: false`, atomic writes.
- Plugin system fixes and `.claude-plugin/plugin.json` writing.

### Changed
- Native plugin directories are now symlinked from the sideload path.

## [0.1.0] — Initial release
- Toolkit discovery, Copilot settings management, tree view, clone from GitHub, pin assets.
