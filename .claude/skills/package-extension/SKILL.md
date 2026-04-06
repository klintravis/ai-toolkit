---
name: package-extension
description: Build, lint, test, and package the extension into a .vsix file
disable-model-invocation: true
---

# Package Extension

Full build pipeline to produce a release-ready .vsix.

## Steps

1. Run `npm run check` (lint + test) -- stop if anything fails
2. Run `npm run compile` to ensure fresh build
3. Run `npm run package` to produce the .vsix
4. Report the .vsix file path and size
