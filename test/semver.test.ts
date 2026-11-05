import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bumpVersion, compareVersions, formatVersion, maxBump, parseVersion, type Version } from '../src/semver.ts';

const v = (text: string): Version => {
  const parsed = parseVersion(text);
  assert.ok(parsed, text);
  return parsed;
};

describe('parseVersion', () => {
  it('parses full SemVer', () => {
    assert.deepEqual(v('1.2.3-rc.1+build.5'), { major: 1, minor: 2, patch: 3, prerelease: ['rc', '1'], build: ['build', '5'] });
    assert.equal(formatVersion(v('10.0.0-alpha+x')), '10.0.0-alpha+x');
  });

  it('rejects invalid versions', () => {
    for (const text of ['1.2', '01.2.3', '1.2.3-', '1.2.3-01', 'v1.2.3', '1.2.3+', '99999999999999999.0.0']) assert.equal(parseVersion(text), undefined, text);
  });
});

describe('compareVersions', () => {
  it('orders by SemVer precedence', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0', '10.0.0'];
    for (let i = 1; i < ordered.length; i++) {
      assert.equal(compareVersions(v(ordered[i - 1]!), v(ordered[i]!)), -1, `${ordered[i - 1]} < ${ordered[i]}`);
      assert.equal(compareVersions(v(ordered[i]!), v(ordered[i - 1]!)), 1);
    }
    assert.equal(compareVersions(v('1.0.0+a'), v('1.0.0+b')), 0);
  });
});

describe('bumpVersion', () => {
  it('bumps and clears prerelease and build', () => {
    assert.equal(formatVersion(bumpVersion(v('1.2.3-rc.1+b'), 'major')), '2.0.0');
    assert.equal(formatVersion(bumpVersion(v('1.2.3'), 'minor')), '1.3.0');
    assert.equal(formatVersion(bumpVersion(v('1.2.3'), 'patch')), '1.2.4');
    assert.equal(formatVersion(bumpVersion(v('1.2.3'), 'none')), '1.2.3');
  });

  it('picks the larger bump', () => {
    assert.equal(maxBump('patch', 'minor'), 'minor');
    assert.equal(maxBump('major', 'none'), 'major');
  });
});
