import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runAction } from './helpers/action.ts';

const TARGET = 'a'.repeat(40);
const PREV = 'b'.repeat(40);
const inputs = {
  'github-token': 'e2e-token',
  'github-repository': 'o/r',
  'tag-prefix': 'v',
  'tag-target': TARGET,
  'bump-default': 'patch',
  'bump-minimum': 'none',
  'tag-annotated': 'false',
  'dry-run': 'false',
};

describe('dist/main.js', () => {
  it('creates the next tag and writes outputs', async () => {
    const result = await runAction(inputs, [
      {
        method: 'GET',
        path: '/repos/o/r/git/matching-refs/tags/v',
        json: [{ ref: 'refs/tags/v0.4.1', object: { type: 'commit', sha: PREV } }],
        check: (req) => assert.equal(req.headers.get('authorization'), 'Bearer e2e-token'),
      },
      {
        method: 'GET',
        path: `/repos/o/r/compare/${PREV}...${TARGET}`,
        json: { status: 'ahead', commits: [{ sha: 'f'.repeat(40), commit: { message: 'feat: shiny' } }] },
      },
      { method: 'POST', path: '/repos/o/r/git/refs', status: 201, json: {}, check: (req) => assert.deepEqual(req.json, { ref: 'refs/tags/v0.5.0', sha: TARGET }) },
    ]);
    assert.equal(result.stderr, '');
    assert.equal(result.code, 0, result.stdout);
    result.api.done();
    assert.match(result.stdout, /^::add-mask::e2e-token$/m);
    assert.deepEqual(result.outputs, {
      tag: 'v0.5.0',
      version: '0.5.0',
      'previous-tag': 'v0.4.1',
      'previous-version': '0.4.1',
      bump: 'minor',
      changelog: '### Features\n\n- shiny (fffffff)\n\n**Full Changelog**: https://github.com/o/r/compare/v0.4.1...v0.5.0',
      'tag-created': 'true',
    });
  });

  it('fails the step on invalid input without calling the API', async () => {
    const result = await runAction({ ...inputs, 'tag-target': 'main' }, []);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^::error::tag-target 'main' must be a full commit SHA$/m);
    assert.deepEqual(result.outputs, {});
    result.api.done();
  });

  it('reports API failures', async () => {
    const result = await runAction(inputs, [
      { method: 'GET', path: '/repos/o/r/git/matching-refs/tags/v', status: 404, json: { message: 'Not Found' }, headers: { 'x-github-request-id': 'R1' } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /::error::GET \/repos\/o\/r\/git\/matching-refs\/tags\/v failed with 404: Not Found \(request R1\)/);
    assert.doesNotMatch(result.stdout.replace(/::add-mask::.*/, ''), /e2e-token/);
  });
});
