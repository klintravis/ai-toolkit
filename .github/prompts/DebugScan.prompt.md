---
description: Debug AI Toolkit scanner behavior with targeted diagnostics, root-cause isolation, and async scan remediation.
argument-hint: describe scan bug
agent: FeatureOrchestrator
---

# Debug Scan

Diagnose scanner issues in discovery, path normalization, and settings integration.

---
**Symptom** [REQUIRED]: ${input:symptom:What is failing or missing?}
**Expected Result** [REQUIRED]: ${input:expected:What should happen?}
**Toolkit Path Sample** [OPTIONAL]: ${input:pathSample:Example external toolkit path}
**Recent Change Context** [OPTIONAL]: ${input:recentChanges:Any recent commits or edits}
---

## Interaction Style
1. Trace scanner and settings flow.
2. Identify likely fault domain and minimal fix strategy.
3. Propose logging or status indicator additions if needed.
4. Wait for `confirm` before implementing code changes.

## Example
Symptom: prompts discovered but skills missing when toolkit is outside home directory.
