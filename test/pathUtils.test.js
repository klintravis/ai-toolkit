const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { expandHomePath, normalizeForComparison, toHomeRelativePath, isPathUnderAnyRoot } = require('../out/pathUtils.js');

/**
 * Unit tests for pathUtils module.
 * Tests all four exported functions: expandHomePath, normalizeForComparison,
 * toHomeRelativePath, and isPathUnderAnyRoot.
 */

const FAKE_HOME = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';

// --- expandHomePath ---

test('expandHomePath - bare tilde expands to home directory', () => {
  const result = expandHomePath('~', FAKE_HOME);
  assert.equal(result, FAKE_HOME);
});

test('expandHomePath - tilde slash prefix expands correctly', () => {
  const result = expandHomePath('~/documents/file.txt', FAKE_HOME);
  assert.equal(result, FAKE_HOME + '/documents/file.txt');
});

test('expandHomePath - tilde backslash prefix expands correctly', () => {
  const result = expandHomePath('~\\documents\\file.txt', FAKE_HOME);
  assert.equal(result, FAKE_HOME + '/documents/file.txt');
});

test('expandHomePath - absolute path passes through with slash normalization', () => {
  const inputPath = process.platform === 'win32' ? 'C:/temp/file.txt' : '/tmp/file.txt';
  const result = expandHomePath(inputPath, FAKE_HOME);
  assert.equal(result, inputPath);
});

test('expandHomePath - normalizes backslashes to forward slashes', () => {
  if (process.platform !== 'win32') { return; }
  const result = expandHomePath('C:\\Users\\test\\docs', FAKE_HOME);
  assert.equal(result, 'C:/Users/test/docs');
});

// --- normalizeForComparison ---

test('normalizeForComparison - strips trailing slashes', () => {
  const a = normalizeForComparison(FAKE_HOME + '/projects/', FAKE_HOME);
  const b = normalizeForComparison(FAKE_HOME + '/projects', FAKE_HOME);
  assert.equal(a, b);
});

test('normalizeForComparison - tilde and absolute forms produce same result', () => {
  const tildeResult = normalizeForComparison('~/projects', FAKE_HOME);
  const absResult = normalizeForComparison(FAKE_HOME + '/projects', FAKE_HOME);
  assert.equal(tildeResult, absResult);
});

test('normalizeForComparison - case-insensitive on Windows', () => {
  if (process.platform !== 'win32') { return; }
  const upper = normalizeForComparison('C:/Users/Test', FAKE_HOME);
  const lower = normalizeForComparison('C:/users/test', FAKE_HOME);
  assert.equal(upper, lower);
});

test('normalizeForComparison - preserves root paths', () => {
  if (process.platform === 'win32') {
    const root = normalizeForComparison('C:/', FAKE_HOME);
    assert.ok(root.endsWith('c:/') || root.endsWith('C:/'), 'Should preserve drive root');
  } else {
    const root = normalizeForComparison('/', FAKE_HOME);
    assert.equal(root, '/');
  }
});

// --- toHomeRelativePath ---

test('toHomeRelativePath - path inside home returns ~/relative', () => {
  const inputPath = path.join(FAKE_HOME, 'documents', 'file.txt');
  const result = toHomeRelativePath(inputPath, FAKE_HOME);
  assert.equal(result, '~/documents/file.txt');
});

test('toHomeRelativePath - home directory itself returns ~', () => {
  const result = toHomeRelativePath(FAKE_HOME, FAKE_HOME);
  assert.equal(result, '~');
});

test('toHomeRelativePath - path outside home returns undefined', () => {
  const outsidePath = process.platform === 'win32' ? 'C:/temp/outside' : '/tmp/outside';
  const result = toHomeRelativePath(outsidePath, FAKE_HOME);
  assert.equal(result, undefined);
});

test('toHomeRelativePath - tilde input is idempotent', () => {
  const result = toHomeRelativePath('~/documents/file.txt', FAKE_HOME);
  assert.equal(result, '~/documents/file.txt');
});

test('toHomeRelativePath - nested subdirectory', () => {
  const inputPath = path.join(FAKE_HOME, 'a', 'b', 'c', 'd.txt');
  const result = toHomeRelativePath(inputPath, FAKE_HOME);
  assert.equal(result, '~/a/b/c/d.txt');
});

test('toHomeRelativePath - normalizes backslashes on Windows', () => {
  if (process.platform !== 'win32') { return; }
  const result = toHomeRelativePath('C:\\Users\\test\\docs\\file.txt', 'C:\\Users\\test');
  assert.equal(result, '~/docs/file.txt');
});

// --- isPathUnderAnyRoot ---

test('isPathUnderAnyRoot - path under one root returns true', () => {
  const root = path.join(FAKE_HOME, 'projects');
  const inputPath = path.join(root, 'my-project', 'src');
  assert.equal(isPathUnderAnyRoot(inputPath, [root], FAKE_HOME), true);
});

test('isPathUnderAnyRoot - path equal to root returns true', () => {
  const root = path.join(FAKE_HOME, 'projects');
  assert.equal(isPathUnderAnyRoot(root, [root], FAKE_HOME), true);
});

test('isPathUnderAnyRoot - path not under any root returns false', () => {
  const root1 = path.join(FAKE_HOME, 'projects');
  const root2 = path.join(FAKE_HOME, 'documents');
  const outsidePath = path.join(FAKE_HOME, 'downloads', 'file.txt');
  assert.equal(isPathUnderAnyRoot(outsidePath, [root1, root2], FAKE_HOME), false);
});

test('isPathUnderAnyRoot - empty roots array returns false', () => {
  const inputPath = path.join(FAKE_HOME, 'any', 'path');
  assert.equal(isPathUnderAnyRoot(inputPath, [], FAKE_HOME), false);
});

test('isPathUnderAnyRoot - matches against multiple roots', () => {
  const root1 = path.join(FAKE_HOME, 'projects');
  const root2 = path.join(FAKE_HOME, 'documents');
  const root3 = path.join(FAKE_HOME, 'downloads');
  const inputPath = path.join(root2, 'work', 'report.txt');
  assert.equal(isPathUnderAnyRoot(inputPath, [root1, root2, root3], FAKE_HOME), true);
});

test('isPathUnderAnyRoot - handles tilde in roots', () => {
  const inputPath = path.join(FAKE_HOME, 'projects', 'repo');
  assert.equal(isPathUnderAnyRoot(inputPath, ['~/projects'], FAKE_HOME), true);
});

test('isPathUnderAnyRoot - handles tilde in input path', () => {
  const root = path.join(FAKE_HOME, 'projects');
  assert.equal(isPathUnderAnyRoot('~/projects/repo', [root], FAKE_HOME), true);
});

test('isPathUnderAnyRoot - does not match partial directory names', () => {
  const root = path.join(FAKE_HOME, 'proj');
  const inputPath = path.join(FAKE_HOME, 'projects', 'file.txt');
  assert.equal(isPathUnderAnyRoot(inputPath, [root], FAKE_HOME), false);
});
