---
description: Scaffold a new tree item type in AI Toolkit with icon/state handling and command routing.
argument-hint: new tree item behavior
agent: FeatureOrchestrator
---

# Add Tree Item

Create a new tree node type and integrate it into rendering and command flows.

---
**Tree Item Kind** [REQUIRED]: ${input:itemKind:status | action | metadata | custom}
**Label Pattern** [REQUIRED]: ${input:labelPattern:How should labels appear?}
**Context Value** [REQUIRED]: ${input:contextValue:context key for menus and commands}
**Primary Action** [OPTIONAL]: ${input:primaryAction:command id for click action}
---

## Interaction Style
1. Propose data contract additions in `src/types.ts` if required.
2. Update item construction logic in `src/treeProvider.ts`.
3. Ensure command/menu integration remains consistent.
4. Wait for `confirm` before final generation.

## Example
Add a warning node that appears when toolkit scan partially fails and links to details.
