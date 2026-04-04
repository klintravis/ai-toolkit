const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { toHomeRelativePath, isPathUnderAnyRoot } = require('../out/pathUtils.js');

/**
 * Unit tests for pathUtils module.
 * Tests path normalization and home-relative path conversions.
 */

test('toHomeRelativePath - path inside home returns ~/relative', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const inputPath = path.join(fakeHome, 'documents', 'file.txt');
  const result = toHomeRelativePath(inputPath, fakeHome);
  assert.equal(result, '~/documents/file.txt');
});

test('toHomeRelativePath - home directory returns ~', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const result = toHomeRelativePath(fakeHome, fakeHome);
  assert.equal(result, '~');
});

test('toHomeRelativePath - path outside home returns undefined', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const outsidePath = process.platform === 'win32' ? 'C:/temp/outside' : '/tmp/outside';
  const result = toHomeRelativePath(outsidePath, fakeHome);
  assert.equal(result, undefined);
});

test('toHomeRelativePath - tilde path expands correctly', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const inputPath = '~/documents/file.txt';
  const result = toHomeRelativePath(inputPath, fakeHome);
  assert.equal(result, '~/documents/file.txt');
});

test('toHomeRelativePath - nested subdirectory', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const inputPath = path.join(fakeHome, 'a', 'b', 'c', 'd.txt');
  const result = toHomeRelativePath(inputPath, fakeHome);
  assert.equal(result, '~/a/b/c/d.txt');
});

test('isPathUnderAnyRoot - path under one root returns true', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const root = path.join(fakeHome, 'projects');
  const inputPath = path.join(root, 'my-project', 'src');
  const result = isPathUnderAnyRoot(inputPath, [root], fakeHome);
  assert.equal(result, true);
});

test('isPathUnderAnyRoot - path equal to root returns true', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const root = path.join(fakeHome, 'projects');
  const result = isPathUnderAnyRoot(root, [root], fakeHome);
  assert.equal(result, true);
});

test('isPathUnderAnyRoot - path not under any root returns false', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const root1 = path.join(fakeHome, 'projects');
  const root2 = path.join(fakeHome, 'documents');
  const outsidePath = path.join(fakeHome, 'downloads', 'file.txt');
  const result = isPathUnderAnyRoot(outsidePath, [root1, root2], fakeHome);
  assert.equal(result, false);
});

test('isPathUnderAnyRoot - empty roots array returns false', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const inputPath = path.join(fakeHome, 'any', 'path');
  const result = isPathUnderAnyRoot(inputPath, [], fakeHome);
  assert.equal(result, false);
});

test('isPathUnderAnyRoot - matches against multiple roots', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const root1 = path.join(fakeHome, 'projects');
  const root2 = path.join(fakeHome, 'documents');
  const root3 = path.join(fakeHome, 'downloads');
  const inputPath = path.join(root2, 'work', 'report.txt');
  const result = isPathUnderAnyRoot(inputPath, [root1, root2, root3], fakeHome);
  assert.equal(result, true);
});

test('isPathUnderAnyRoot - handles tilde in roots', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const inputPath = path.join(fakeHome, 'projects', 'repo');
  const result = isPathUnderAnyRoot(inputPath, ['~/projects'], fakeHome);
  assert.equal(result, true);
});

test('isPathUnderAnyRoot - handles tilde in input path', () => {
  const fakeHome = process.platform === 'win32' ? 'C:/Users/test' : '/home/test';
  const root = path.join(fakeHome, 'projects');
  const result = isPathUnderAnyRoot('~/projects/repo', [root], fakeHome);
  assert.equal(result, true);
});
