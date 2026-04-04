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
  /** Unique ID: `{toolkitId}::{assetType}/{name}` */
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
}

/**
 * Known file patterns for each asset type.
 */
export const ASSET_PATTERNS: Record<AssetType, { extensions: string[]; folderBased: boolean }> = {
  [AssetType.Agent]: { extensions: ['.agent.md'], folderBased: false },
  [AssetType.Instruction]: { extensions: ['.instructions.md'], folderBased: false },
  [AssetType.Skill]: { extensions: ['SKILL.md'], folderBased: true },
  [AssetType.Prompt]: { extensions: ['.prompt.md'], folderBased: false },
  [AssetType.Plugin]: { extensions: ['plugin.md', 'plugin.json', 'plugin.yaml'], folderBased: true },
  [AssetType.Hook]: { extensions: ['.json', '.md'], folderBased: true },
  [AssetType.Workflow]: { extensions: ['.md'], folderBased: false },
  [AssetType.Standard]: { extensions: ['.md'], folderBased: true },
};

/**
 * Where each asset type should be placed in the workspace target directory.
 */
export const TARGET_SUBDIRS: Record<AssetType, string> = {
  [AssetType.Agent]: 'agents',
  [AssetType.Instruction]: 'instructions',
  [AssetType.Skill]: 'skills',
  [AssetType.Prompt]: 'prompts',
  [AssetType.Plugin]: 'plugins',
  [AssetType.Hook]: 'hooks',
  [AssetType.Workflow]: 'workflows',
  [AssetType.Standard]: 'standards',
};
