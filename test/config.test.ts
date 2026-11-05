import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Inputs } from '../src/lib/actions.ts';
import { readConfig } from '../src/config.ts';

const SHA = 'a'.repeat(40);
const base = {
  'INPUT_GITHUB-TOKEN': 'tok',
  'INPUT_GITHUB-REPOSITORY': 'o/r',
  'INPUT_TAG-PREFIX': 'v',
  'INPUT_TAG-TARGET': SHA,
};
const read = (env: Record<string, string> = {}) => readConfig(new Inputs({ ...base, ...env }), env);

describe('readConfig', () => {
  it('applies defaults', () => {
    const config = read();
    assert.equal(config.owner, 'o');
    assert.equal(config.repo, 'r');
    assert.equal(config.serverUrl, 'https://github.com');
    assert.equal(config.custom, undefined);
    assert.equal(config.bumpDefault, 'patch');
    assert.equal(config.bumpMinimum, 'none');
    assert.equal(config.dryRun, false);
    assert.deepEqual(config.rules.map((r) => r.type), ['feat', 'fix', 'perf', 'revert']);
  });

  it('reads overrides', () => {
    const config = read({
      GITHUB_SERVER_URL: 'https://ghe.example/',
      'INPUT_TAG-CUSTOM': 'v2.0.0-rc.1',
      'INPUT_BUMP-RULES': 'fix:minor:Fixes,chore:patch',
      'INPUT_BUMP-DEFAULT': 'none',
      'INPUT_BUMP-MINIMUM': 'minor',
      'INPUT_TAG-ANNOTATED': 'true',
      'INPUT_TAG-MESSAGE': 'msg',
      'INPUT_DRY-RUN': 'true',
    });
    assert.equal(config.serverUrl, 'https://ghe.example');
    assert.deepEqual(config.custom?.prerelease, ['rc', '1']);
    assert.deepEqual(config.rules.find((r) => r.type === 'fix'), { type: 'fix', bump: 'minor', section: 'Fixes' });
    assert.ok(config.rules.some((r) => r.type === 'chore'));
    assert.equal(config.bumpDefault, 'none');
    assert.equal(config.bumpMinimum, 'minor');
    assert.equal(config.annotated, true);
    assert.equal(config.message, 'msg');
    assert.equal(config.dryRun, true);
  });

  it('accepts custom versions without the prefix', () => {
    assert.equal(read({ 'INPUT_TAG-CUSTOM': '1.2.3' }).custom?.minor, 2);
  });

  it('rejects bad input', () => {
    assert.throws(() => read({ 'INPUT_TAG-TARGET': 'main' }), /full commit SHA/);
    assert.throws(() => read({ 'INPUT_TAG-CUSTOM': 'v1.2' }), /not a semantic version/);
    assert.throws(() => read({ 'INPUT_TAG-PREFIX': 'v;x' }), /unsupported characters/);
    assert.throws(() => read({ 'INPUT_GITHUB-REPOSITORY': 'nope' }), /owner\/name/);
    assert.throws(() => read({ 'INPUT_BUMP-DEFAULT': 'big' }), /one of/);
    assert.throws(() => read({ 'INPUT_GITHUB-TOKEN': '' }), /github-token' is required/);
  });
});
