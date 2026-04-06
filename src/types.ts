/**
 * Asset types recognized by the AI Toolkit.
 * Maps to folder names in both awesome-copilot and CopilotCustomizer formats.
 */
export enum AssetType {
  Agent = 'agents',
  Instruction = 'instructions',
  Skill = 'skills',
  Prompt = 'prompts',
  Plugin = 'plugins',
  Hook = 'hooks',
  Workflow = 'workflows',
  Standard = 'standards',
}

/**
 * The format/layout of a discovered toolkit source.
 */
export enum SourceFormat {
  /** awesome-copilot style: assets at top-level (agents/, skills/, etc.) */
  AwesomeCopilot = 'awesome-copilot',
  /** CopilotCustomizer style: assets under .github/ */
  CopilotCustomizer = 'copilot-customizer',
  /** Generic: a single folder of assets (e.g. just an instructions/ folder) */
  Generic = 'generic',
}

/**
 * A single AI asset file (agent, instruction, skill, etc.)
 */
export interface Asset {
  /** Unique ID: `{toolkitId}::{relativePath}` */
  id: string;
  /** Display name derived from filename */
  name: string;
  /** Type of asset */
  type: AssetType;
  /** Absolute path to the asset file or folder */
  sourcePath: string;
  /** Relative path within the toolkit (e.g., `agents/my-agent.agent.md`) */
  relativePath: string;
  /** Whether this is a folder-based asset (e.g., skills) */
  isFolder: boolean;
  /** For folder-based assets, the files contained inside (shallow recursive). */
  children?: Asset[];
}

/**
 * A discovered toolkit — a collection of assets from a single source folder.
 */
export interface Toolkit {
  /** Unique ID derived from the source path */
  id: string;
  /** Display name (folder name or repo name) */
  name: string;
  /** Absolute path to the toolkit root */
  rootPath: string;
  /** Detected source format */
  format: SourceFormat;
  /** All discovered assets within this toolkit */
  assets: Asset[];
  /** Whether this toolkit is currently enabled */
  enabled: boolean;
  /** True when this toolkit was cloned via the extension (layered on post-scan). */
  isCloned?: boolean;
  /** True when this toolkit is a pick group folder (under picksDir). */
  isPinGroup?: boolean;
  /** Populated by UpdateChecker after git fetch; undefined for non-cloned. */
  update?: ToolkitUpdateStatus;
}

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

/** Default group used when the user does not choose one. */
export const DEFAULT_PIN_GROUP = 'default';

/** Persisted record of an asset pinned into the user's pins directory. */
export interface PinRecord {
  /** Original asset id (toolkitId::relativePath). */
  assetId: string;
  /** Group/collection name that materializes as its own sub-toolkit. */
  groupName: string;
  /** Toolkit the asset came from. */
  toolkitId: string;
  /** Toolkit display name at time of pinning (for disambiguation). */
  toolkitName: string;
  /** Asset type — determines which subfolder under picks/. */
  assetType: AssetType;
  /** Original asset name (display). */
  assetName: string;
  /** Absolute path to the original asset file or folder. */
  sourcePath: string;
  /** Absolute path to the link/copy under the picks directory. */
  targetPath: string;
  /** How the pick was materialized on disk. */
  linkType: 'symlink' | 'junction' | 'copy';
  /** True when the source is a folder asset. */
  isFolder: boolean;
  /** ISO timestamp when pinned. */
  pinnedAt: string;
}

/** Minimal output channel interface — decoupled from vscode.OutputChannel. */
export interface OutputLog {
  appendLine(line: string): void;
}

/** Minimal ExtensionContext.globalState subset — allows test injection. */
export interface GlobalStateContext {
  globalState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

/** Persisted metadata about a git-cloned toolkit. */
export interface ClonedToolkitRecord {
  /** Absolute path to the clone directory (forward slashes). */
  rootPath: string;
  /** Git remote URL used when cloning. */
  remoteUrl: string;
  /** Branch that was cloned (e.g. "main"). */
  branch: string;
  /** SHA at time of clone / last successful pull. */
  lastKnownSha: string;
  /** ISO timestamp of clone. */
  clonedAt: string;
}
