const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactCredentials } = require('../out/redact.js');

test('redactCredentials - strips user:pass from https URL', () => {
  const input = 'fatal: unable to access https://alice:secret@github.com/x/y.git';
  assert.equal(
    redactCredentials(input),
    'fatal: unable to access https://***:***@github.com/x/y.git',
  );
});

test('redactCredentials - leaves non-credential strings alone', () => {
  assert.equal(redactCredentials('plain error message'), 'plain error message');
});

test('redactCredentials - handles multiple occurrences', () => {
  const input = 'try https://a:1@h/x and https://b:2@h/y';
  const out = redactCredentials(input);
  assert.ok(!out.includes('a:1'));
  assert.ok(!out.includes('b:2'));
});

test('redactCredentials - strips user:pass from ssh:// URL', () => {
  assert.equal(
    redactCredentials('ssh://alice:secret@host.example/x.git'),
    'ssh://***:***@host.example/x.git',
  );
});

test('redactCredentials - leaves credential-less ssh URL alone', () => {
  // ssh://git@host has no colon-password, so the regex must not match.
  assert.equal(
    redactCredentials('ssh://git@github.com/x/y.git'),
    'ssh://git@github.com/x/y.git',
  );
});
