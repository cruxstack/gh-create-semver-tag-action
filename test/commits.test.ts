import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyze, DEFAULT_RULES, mergeRules, parseCommit, parseRules, renderChangelog, type Commit } from '../src/commits.ts';

const commit = (message: string, sha = 'abcdef1234567890'): Commit => ({ sha, message, url: `https://github.com/o/r/commit/${sha}` });

describe('parseCommit', () => {
  it('parses type, scope, subject and breaking markers', () => {
    assert.deepEqual(parseCommit(commit('feat(api): add thing\n\nbody')), {
      ...commit('feat(api): add thing\n\nbody'),
      type: 'feat',
      scope: 'api',
      subject: 'add thing',
      breaking: false,
    });
    assert.equal(parseCommit(commit('Fix!: drop x'))?.type, 'fix');
    assert.equal(parseCommit(commit('fix!: drop x'))?.breaking, true);
    assert.equal(parseCommit(commit('chore: x\n\nBREAKING CHANGE: gone'))?.breaking, true);
    assert.equal(parseCommit(commit('chore: x\n\nBREAKING-CHANGE: gone'))?.breaking, true);
    assert.equal(parseCommit(commit('chore: x\n\nnot a BREAKING CHANGE: here'))?.breaking, false);
  });

  it('ignores non-conventional messages', () => {
    for (const message of ['Merge pull request #1 from a/b', 'Revert "feat: x"', 'feat:no space', 'feat(): x', '']) {
      assert.equal(parseCommit(commit(message)), undefined, message);
    }
  });
});

describe('rules', () => {
  it('parses type:bump[:section] entries', () => {
    assert.deepEqual(parseRules(['Fix:minor:Bug Fixes: Extra', 'chore:none']), [
      { type: 'fix', bump: 'minor', section: 'Bug Fixes: Extra' },
      { type: 'chore', bump: 'none' },
    ]);
    assert.throws(() => parseRules(['fix:huge']), /must use one of/);
    assert.throws(() => parseRules([':minor']), /invalid type/);
  });

  it('merges overrides by type', () => {
    const merged = mergeRules(DEFAULT_RULES, parseRules(['fix:minor:Fixes', 'docs:patch']));
    assert.deepEqual(merged.map((r) => `${r.type}:${r.bump}`), ['feat:minor', 'fix:minor', 'perf:patch', 'revert:patch', 'docs:patch']);
  });
});

describe('analyze', () => {
  it('takes the largest bump', () => {
    const result = analyze([commit('fix: a'), commit('feat: b'), commit('docs: c'), commit('wip')], DEFAULT_RULES);
    assert.equal(result.bump, 'minor');
    assert.equal(result.matched, true);
    assert.equal(result.commits.length, 3);
  });

  it('treats any breaking commit as major', () => {
    assert.equal(analyze([commit('feat: a'), commit('docs!: b')], DEFAULT_RULES).bump, 'major');
  });

  it('reports when nothing matched', () => {
    assert.deepEqual(analyze([commit('docs: a'), commit('misc')], DEFAULT_RULES).matched, false);
  });

  it('counts explicit none rules as matched', () => {
    const result = analyze([commit('chore: a')], parseRules(['chore:none']));
    assert.equal(result.matched, true);
    assert.equal(result.bump, 'none');
  });
});

describe('renderChangelog', () => {
  it('groups by section, newest first, with breaking changes on top', () => {
    const rules = mergeRules(DEFAULT_RULES, parseRules(['chore:none']));
    const { commits } = analyze(
      [commit('fix: old fix', '1111111aaaa'), commit('feat(ui)!: new ui', '2222222bbbb'), commit('feat: newer', '3333333cccc'), commit('chore: hidden', '4444444')],
      rules,
    );
    const text = renderChangelog(commits, rules, 'https://github.com/o/r/compare/v1.0.0...v2.0.0');
    assert.equal(
      text,
      [
        '### Breaking Changes',
        '',
        '- **ui:** new ui ([2222222](https://github.com/o/r/commit/2222222bbbb))',
        '',
        '### Features',
        '',
        '- newer ([3333333](https://github.com/o/r/commit/3333333cccc))',
        '- **ui:** new ui ([2222222](https://github.com/o/r/commit/2222222bbbb))',
        '',
        '### Bug Fixes',
        '',
        '- old fix ([1111111](https://github.com/o/r/commit/1111111aaaa))',
        '',
        '**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v2.0.0',
      ].join('\n'),
    );
  });

  it('renders plain SHAs without URLs and nothing for no entries', () => {
    assert.equal(renderChangelog([{ sha: 'abcdef123', message: '', type: 'fix', subject: 's', breaking: false }], DEFAULT_RULES), '### Bug Fixes\n\n- s (abcdef1)');
    assert.equal(renderChangelog([], DEFAULT_RULES), '');
  });
});
