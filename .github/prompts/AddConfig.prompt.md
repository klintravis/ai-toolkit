---
description: Add or update AI Toolkit configuration settings with schema updates and settings handling changes.
argument-hint: setting key and intent
agent: FeatureOrchestrator
---

# Add Config

Introduce a new extension configuration setting and wire it through code paths safely.

---
**Setting Key** [REQUIRED]: ${input:settingKey:aiToolkit.exampleSetting}
**Setting Type** [REQUIRED]: ${input:settingType:string, boolean, number, array, or object}
**Default Value** [REQUIRED]: ${input:defaultValue:Provide JSON-compatible default}
**Behavior Impact** [REQUIRED]: ${input:impact:How does this setting affect behavior?}
---

## Interaction Style
1. Update `package.json` contributes configuration section.
2. Update reading/writing logic in TypeScript sources.
3. Add validation and migration notes when needed.
4. Wait for `confirm` before writing final patch.

## Example
Add `aiToolkit.maxScanResults` to cap scan results per toolkit and surface overflow state.
