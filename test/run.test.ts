import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Log } from '../src/lib/actions.ts';
import { GitHub } from '../src/lib/github.ts';
import { DEFAULT_RULES, parseRules, mergeRules } from '../src/commits.ts';
import type { Config } from '../src/config.ts';
import { run } from '../src/run.ts';
import { parseVersion } from '../src/semver.ts';
import { fakeFetch, type Route } from './helpers/fake-fetch.ts';

const TARGET = 'a'.repeat(40);
const PREV = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

const config = (overrides: Partial<Config> = {}): Config => ({
  token: 't',
  owner: 'o',
  repo: 'r',
  serverUrl: 'https://github.com',
  prefix: 'v',
  target: TARGET,
  custom: undefined,
  annotated: false,
  message: '',
  rules: [...DEFAULT_RULES],
  bumpDefault: 'patch',
  bumpMinimum: 'none',
  dryRun: false,
  ...overrides,
});

const tagsRoute = (tags: [name: string, sha?: string, type?: string][], prefix = 'v'): Route => ({
  method: 'GET',
  path: `/repos/o/r/git/matching-refs/tags${prefix ? `/${prefix}` : ''}`,
  json: tags.map(([name, sha = PREV, type = 'commit']) => ({ ref: `refs/tags/${name}`, object: { type, sha } })),
});

const commits = (messages: string[]) =>
  messages.map((message, i) => ({ sha: `${i}`.repeat(40), html_url: `https://github.com/o/r/commit/${i}`, commit: { message } }));

const compareRoute = (status: string, messages: string[], base = PREV): Route => ({
  method: 'GET',
  path: `/repos/o/r/compare/${base}...${TARGET}`,
  json: { status, commits: commits(messages) },
});

const createRefRoute = (tag: string, sha = TARGET, status = 201): Route => ({
  method: 'POST',
  path: '/repos/o/r/git/refs',
  status,
  json: status === 201 ? { ref: `refs/tags/${tag}` } : { message: 'Reference already exists' },
  check: (req) => assert.deepEqual(req.json, { ref: `refs/tags/${tag}`, sha }),
});

async function execute(routes: Route[], overrides: Partial<Config> = {}) {
  const fake = fakeFetch(routes);
  const logs: string[] = [];
  const log: Log = { debug() {}, info: (m) => logs.push(m), warning: (m) => logs.push(`warn: ${m}`), error() {} };
  const github = new GitHub({ token: 't', userAgent: 'test', apiUrl: 'https://api.github.com', fetch: fake.fetch, sleep: async () => {} });
  const outputs = await run(config(overrides), { github, log });
  fake.done();
  return { outputs, logs };
}

describe('run', () => {
  it('bumps from the highest stable tag and creates the tag', async () => {
    const { outputs } = await execute([
      tagsRoute([['v1.2.0'], ['v1.10.0'], ['v1.9.0', OTHER], ['v2.0.0-rc.1', OTHER], ['vendor', OTHER], ['v1.11']]),
      compareRoute('ahead', ['fix: a', 'feat(x): b', 'docs: c']),
      createRefRoute('v1.11.0'),
    ]);
    assert.deepEqual(outputs, {
      tag: 'v1.11.0',
      version: '1.11.0',
      'previous-tag': 'v1.10.0',
      'previous-version': '1.10.0',
      bump: 'minor',
      changelog: [
        '### Features',
        '',
        '- **x:** b ([1111111](https://github.com/o/r/commit/1))',
        '',
        '### Bug Fixes',
        '',
        '- a ([0000000](https://github.com/o/r/commit/0))',
        '',
        '**Full Changelog**: https://github.com/o/r/compare/v1.10.0...v1.11.0',
      ].join('\n'),
      'tag-created': true,
    });
  });

  it('bumps major for breaking changes', async () => {
    const { outputs } = await execute([tagsRoute([['v1.2.3']]), compareRoute('diverged', ['refactor!: x']), createRefRoute('v2.0.0')]);
    assert.equal(outputs['tag'], 'v2.0.0');
    assert.equal(outputs['bump'], 'major');
  });

  it('uses bump-default when no commit matches, then applies bump-minimum', async () => {
    const { outputs } = await execute([tagsRoute([['v1.2.3']]), compareRoute('ahead', ['docs: x'])], { dryRun: true });
    assert.equal(outputs['tag'], 'v1.2.4');
    assert.equal(outputs['tag-created'], false);

    const floored = await execute([tagsRoute([['v1.2.3']]), compareRoute('ahead', ['fix: x'])], { dryRun: true, bumpMinimum: 'minor' });
    assert.equal(floored.outputs['tag'], 'v1.3.0');
  });

  it('skips the release when the bump is none', async () => {
    const { outputs, logs } = await execute([tagsRoute([['v1.2.3']]), compareRoute('ahead', ['docs: x'])], { bumpDefault: 'none', bumpMinimum: 'minor' });
    assert.equal(outputs['tag'], '');
    assert.equal(outputs['bump'], 'none');
    assert.equal(outputs['previous-tag'], 'v1.2.3');
    assert.match(logs.join('\n'), /1 commit\(s\) since v1.2.3; bump: none/);
  });

  it('respects explicit none rules', async () => {
    const rules = mergeRules(DEFAULT_RULES, parseRules(['chore:none']));
    const { outputs } = await execute([tagsRoute([['v1.0.0']]), compareRoute('ahead', ['chore: deps'])], { rules });
    assert.equal(outputs['bump'], 'none');
  });

  it('returns the existing tag when the target is already released', async () => {
    const { outputs } = await execute([tagsRoute([['v3.0.0']]), compareRoute('identical', [])]);
    assert.equal(outputs['tag'], 'v3.0.0');
    assert.equal(outputs['bump'], 'none');
    assert.equal(outputs['tag-created'], false);
  });

  it('does nothing when the target is behind the latest tag', async () => {
    const { outputs } = await execute([tagsRoute([['v3.0.0']]), compareRoute('behind', [])]);
    assert.equal(outputs['tag'], '');
    assert.equal(outputs['bump'], 'none');
  });

  it('analyzes history when there is no previous tag', async () => {
    const { outputs } = await execute([
      tagsRoute([]),
      {
        method: 'GET',
        path: '/repos/o/r/commits',
        json: commits(['feat: newest', 'fix: oldest']),
        check: (req) => assert.equal(req.url.searchParams.get('sha'), TARGET),
      },
      createRefRoute('v0.1.0'),
    ]);
    assert.equal(outputs['tag'], 'v0.1.0');
    assert.equal(outputs['previous-tag'], '');
    assert.doesNotMatch(String(outputs['changelog']), /Full Changelog/);
  });

  it('caps initial history analysis', async () => {
    const page = commits(Array.from({ length: 100 }, () => 'docs: x'));
    const routes: Route[] = [tagsRoute([])];
    for (let i = 0; i < 11; i++) {
      routes.push({ method: 'GET', path: `/repos/o/r/commits${i ? i : ''}`, json: page, headers: { link: `<https://api.github.com/repos/o/r/commits${i + 1}>; rel="next"` } });
    }
    const { outputs, logs } = await execute(routes, { dryRun: true });
    assert.equal(outputs['tag'], 'v0.0.1');
    assert.ok(logs.includes('warn: Only the latest 1000 commits were analyzed'));
  });

  it('peels annotated previous tags and creates annotated tags', async () => {
    const tagObject = 'd'.repeat(40);
    const newTagObject = 'e'.repeat(40);
    const { outputs } = await execute(
      [
        tagsRoute([['v1.0.0', tagObject, 'tag']]),
        { method: 'GET', path: `/repos/o/r/git/tags/${tagObject}`, json: { object: { type: 'commit', sha: PREV } } },
        compareRoute('ahead', ['feat: x']),
        {
          method: 'POST',
          path: '/repos/o/r/git/tags',
          status: 201,
          json: { sha: newTagObject },
          check: (req) => assert.deepEqual(req.json, { tag: 'v1.1.0', message: 'Release notes', object: TARGET, type: 'commit' }),
        },
        createRefRoute('v1.1.0', newTagObject),
      ],
      { annotated: true, message: 'Release notes' },
    );
    assert.equal(outputs['tag-created'], true);
  });

  it('rejects tags that point at trees', async () => {
    await assert.rejects(execute([tagsRoute([['v1.0.0', OTHER, 'tree']])]), /tag points to a tree/);
  });

  it('uses a custom version and the closest lower tag as previous', async () => {
    const { outputs } = await execute(
      [tagsRoute([['v1.0.0'], ['v2.0.0', OTHER], ['v2.1.0', OTHER]]), compareRoute('ahead', ['fix: x']), createRefRoute('v2.0.0')],
      { custom: parseVersion('2.0.0') },
    );
    assert.equal(outputs['tag'], 'v2.0.0');
    assert.equal(outputs['previous-tag'], 'v1.0.0');
    assert.equal(outputs['bump'], 'custom');
    assert.match(String(outputs['changelog']), /compare\/v1.0.0...v2.0.0/);
  });

  it('succeeds without creating when the tag already exists at the target', async () => {
    const { outputs } = await execute([
      tagsRoute([['v1.0.0']]),
      compareRoute('ahead', ['fix: x']),
      createRefRoute('v1.0.1', TARGET, 422),
      { method: 'GET', path: '/repos/o/r/git/ref/tags/v1.0.1', json: { object: { type: 'commit', sha: TARGET } } },
    ]);
    assert.equal(outputs['tag-created'], false);
  });

  it('fails when the tag exists elsewhere or cannot be created', async () => {
    await assert.rejects(
      execute([
        tagsRoute([['v1.0.0']]),
        compareRoute('ahead', ['fix: x']),
        createRefRoute('v1.0.1', TARGET, 422),
        { method: 'GET', path: '/repos/o/r/git/ref/tags/v1.0.1', json: { object: { type: 'commit', sha: OTHER } } },
      ]),
      /v1.0.1 already exists at c{40}, not a{40}/,
    );
    await assert.rejects(
      execute([
        tagsRoute([['v1.0.0']]),
        compareRoute('ahead', ['fix: x']),
        createRefRoute('v1.0.1', TARGET, 422),
        { method: 'GET', path: '/repos/o/r/git/ref/tags/v1.0.1', status: 404, json: { message: 'Not Found' } },
      ]),
      /could not create v1.0.1: Reference already exists/,
    );
  });

  it('supports an empty prefix', async () => {
    const { outputs } = await execute([tagsRoute([['1.0.0'], ['v9.0.0', OTHER]], ''), compareRoute('ahead', ['feat: x'])], { prefix: '', dryRun: true });
    assert.equal(outputs['tag'], '1.1.0');
  });
});
