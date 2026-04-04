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
