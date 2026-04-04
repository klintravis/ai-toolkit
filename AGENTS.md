# AGENTS.md - AI Toolkit

AI Toolkit is a VS Code extension for managing Copilot customization assets from external toolkit folders. It discovers agents, instructions, prompts, skills, and related artifacts, then surfaces toolkit state in a sidebar.

## Quick Start
- Install: `npm install`
- Compile: `npm run compile`
- Watch: `npm run watch`
- Launch Extension Host: press `F5` in VS Code
- Optional sandbox launch task: `Launch Installed AI Toolkit Sandbox`

## Project Overview
- Stack: TypeScript, VS Code Extension API, ES2022 target.
- Activation: `onStartupFinished`.
- Primary responsibility: map external toolkit folders to Copilot discovery settings and render toolkit state.

## Architecture
- `src/scanner.ts`: scans configured toolkit paths and discovers assets.
- `src/treeProvider.ts`: maps toolkit state into tree nodes and item actions.
- `src/extension.ts`: activation, command registration, and orchestration.
- `src/copilotSettings.ts`: applies/removes managed Copilot discovery locations.
- `src/types.ts`: shared type contracts and constants.

Flow:
1. Scanner discovers assets and status.
2. Tree provider renders toolkit and asset nodes.
3. Extension commands mutate state and trigger refresh.
4. Copilot settings manager updates discovery keys.

## Conventions
- Keep command handlers small; delegate logic.
- Prefer async APIs on extension host paths.
- Never swallow errors silently; report actionable details.
- Keep names explicit and domain-specific.
- Push all disposables to `context.subscriptions`.

## Testing Guidance
- Priority: unit tests for scanner, settings, and tree mappings.
- Mock VS Code APIs rather than invoking real workspace state.
- Cover async failures and cancellation paths.

## Available Agents
- `FeatureOrchestrator`: conductor for multi-file feature work.
- `AssetDiscovery`: scanner/discovery specialist.
- `SidebarTree`: tree rendering and status specialist.
- `QualityGuard`: tests and quality review specialist.

## Available Skills
- `vscode-extension-patterns`
- `async-file-operations`
- `extension-testing-strategies`
- `copilot-settings-management`
- `code-review`

## Available Prompts
- `/AddCommand`: scaffold new extension commands.
- `/AddConfig`: add configuration settings safely.
- `/DebugScan`: debug scanner/discovery issues.
- `/AddTreeItem`: scaffold new tree node types.
- `/Review`: run quality and AI slop review.

## Available Instructions
- `ExtensionDevelopment.instructions.md`: VS Code extension development rules for activation, command registration, disposables, and resilient API usage.
  - Applied to: `src/**/*.ts`
- `Testing.instructions.md`: Testing rules for AI Toolkit extension behavior with VS Code API mocks, fixtures, and async assertions.
  - Applied to: `**/*.test.ts` (ready for when tests are added)

## Common Workflows
1. Add Feature
- Use `FeatureOrchestrator` with `/AddCommand` or `/AddTreeItem`.
- Delegate scanner work to `AssetDiscovery`.
- Run `QualityGuard` review before merge.

2. Debug Discovery
- Start with `/DebugScan`.
- Validate settings behavior through `copilot-settings-management` skill.
- Add regression tests for discovered root cause.

3. Review Change Set
- Run `/Review` on changed files.
- Address high-severity findings first.
- Confirm test coverage for behavior changes.

## PR Guidelines
- Keep PR scope focused and explain user-visible behavior changes.
- Include tests or an explicit rationale when tests are deferred.
- Confirm compile success before submitting.
