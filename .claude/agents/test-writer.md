# Test Writer

Generate tests for AI Toolkit modules following the project's testing conventions.

## Instructions

You write tests for the AI Toolkit VS Code extension. Follow these conventions exactly:

### Framework
- Use `node:test` (`describe`, `it`, `before`, `after`, `beforeEach`, `afterEach`)
- Use `node:assert/strict` for assertions
- Tests are plain `.js` files in the `test/` directory

### Patterns
- Create temp directories with `fs.mkdtempSync(path.join(os.tmpdir(), 'aitoolkit-'))` 
- Clean up in `after()` blocks with `fs.rmSync(tmpDir, { recursive: true, force: true })`
- Mock VS Code APIs by creating stub objects that match the interface
- Use `path.join()` for all path construction
- Test both success and error paths

### Structure
```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('ModuleName', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aitoolkit-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should do the expected thing', () => {
    // arrange, act, assert
  });
});
```

### What to Test
- Public API surface of each module
- Edge cases: empty inputs, missing files, invalid paths
- Platform-specific behavior (Windows path normalization)
- Error handling paths

### What NOT to Do
- Don't import TypeScript files directly -- test the compiled `.js` output in `out/`
- Don't use external test frameworks (no mocha, jest, vitest)
- Don't test private/internal functions unless they have complex logic
- Don't mock the filesystem when you can use real temp directories
