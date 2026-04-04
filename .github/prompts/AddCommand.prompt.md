---
description: Generate a new AI Toolkit command with registration, implementation skeleton, and tree integration notes.
argument-hint: command purpose and behavior
agent: FeatureOrchestrator
---

# Add Command

Create a new VS Code command for AI Toolkit using existing command and contribution patterns.

---
**Command Name** [REQUIRED]: ${input:commandName:aiToolkit.newCommandName}
**User Title** [REQUIRED]: ${input:commandTitle:AI Toolkit: New Command}
**Behavior Summary** [REQUIRED]: ${input:behavior:What should the command do?}
**Touches Tree View** [OPTIONAL]: ${input:touchesTree:yes or no}
**Needs Config Update** [OPTIONAL]: ${input:needsConfig:yes or no}
---

## Interaction Style
1. Analyze where command contribution belongs.
2. Propose edits for `package.json` and `src/extension.ts`.
3. Include follow-up test recommendations.
4. Wait for `confirm` before final generation.

## Example
Input: command to toggle visibility of disabled assets in tree.
Output: command contribution, registration function, and tree refresh hook.
