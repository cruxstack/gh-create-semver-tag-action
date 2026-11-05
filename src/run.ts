import type { Log, OutputValue } from './lib/actions.ts';
import { path, type GitHub } from './lib/github.ts';
import { assertRefName } from './lib/refname.ts';
import { analyze, renderChangelog, type Commit } from './commits.ts';
import { bumpVersion, compareVersions, formatVersion, maxBump, parseVersion, type Bump, type Version } from './semver.ts';
import type { Config } from './config.ts';

export interface Deps {
  github: GitHub;
  log: Log;
}

interface GitObject {
  type: string;
  sha: string;
}

interface VersionTag {
  name: string;
  version: Version;
  object: GitObject;
}

interface ApiCommit {
  sha: string;
  html_url?: string;
  commit: { message: string };
}

interface CommitRange {
  status: string;
  commits: Commit[];
}

const ZERO: Version = { major: 0, minor: 0, patch: 0, prerelease: [], build: [] };
const MAX_INITIAL_COMMITS = 1000;

export async function run(config: Config, { github, log }: Deps): Promise<Record<string, OutputValue>> {
  const repoPath = path`/repos/${config.owner}/${config.repo}`;
  const previous = latest(await listVersionTags(github, repoPath, config.prefix), config.custom);
  log.info(previous ? `Previous version: ${previous.name}` : 'No previous version tag');

  const range = await collectCommits(github, repoPath, config.target, previous, log);
  const outputs = {
    tag: '',
    version: '',
    'previous-tag': previous?.name ?? '',
    'previous-version': previous ? formatVersion(previous.version) : '',
    bump: 'none',
    changelog: '',
    'tag-created': false,
  };

  if (!config.custom && previous && range.status === 'identical') {
    log.info(`${config.target} is already tagged ${previous.name}`);
    return { ...outputs, tag: previous.name, version: formatVersion(previous.version) };
  }

  const analysis = analyze(range.commits, config.rules);
  let version = config.custom;
  if (!version) {
    let bump: Bump = analysis.matched ? analysis.bump : config.bumpDefault;
    if (!range.commits.length) bump = 'none';
    if (bump !== 'none') bump = maxBump(bump, config.bumpMinimum);
    outputs.bump = bump;
    log.info(`${range.commits.length} commit(s) since ${previous?.name ?? 'the beginning'}; bump: ${bump}`);
    if (bump === 'none') return outputs;
    version = bumpVersion(previous?.version ?? ZERO, bump);
  } else {
    outputs.bump = 'custom';
  }

  const tag = assertRefName('tag', `${config.prefix}${formatVersion(version)}`);
  const compareUrl = previous ? `${config.serverUrl}/${config.owner}/${config.repo}/compare/${previous.name}...${tag}` : undefined;
  outputs.tag = tag;
  outputs.version = formatVersion(version);
  outputs.changelog = renderChangelog(analysis.commits, config.rules, compareUrl);

  if (config.dryRun) {
    log.info(`Dry run: ${tag} not created`);
  } else {
    outputs['tag-created'] = await createTag(github, repoPath, config, tag);
    log.info(outputs['tag-created'] ? `Created ${tag} at ${config.target}` : `${tag} already exists at ${config.target}`);
  }
  return outputs;
}

async function listVersionTags(github: GitHub, repoPath: string, prefix: string): Promise<VersionTag[]> {
  const tags: VersionTag[] = [];
  const refs = github.paginate<{ ref: string; object: GitObject }>(repoPath + path`/git/matching-refs/${prefix ? `tags/${prefix}` : 'tags'}`);
  for await (const ref of refs) {
    if (!ref.ref.startsWith(`refs/tags/${prefix}`)) continue;
    const name = ref.ref.slice('refs/tags/'.length);
    const version = parseVersion(name.slice(prefix.length));
    if (version && !version.prerelease.length) tags.push({ name, version, object: ref.object });
  }
  return tags;
}

/** Highest stable tag, below `ceiling` when set. */
function latest(tags: readonly VersionTag[], ceiling: Version | undefined): VersionTag | undefined {
  let best: VersionTag | undefined;
  for (const tag of tags) {
    if (ceiling && compareVersions(tag.version, ceiling) >= 0) continue;
    if (!best || compareVersions(tag.version, best.version) > 0) best = tag;
  }
  return best;
}

async function collectCommits(github: GitHub, repoPath: string, target: string, previous: VersionTag | undefined, log: Log): Promise<CommitRange> {
  const toCommit = (c: ApiCommit): Commit => ({ sha: c.sha, message: c.commit.message, ...(c.html_url ? { url: c.html_url } : {}) });

  if (!previous) {
    const commits: Commit[] = [];
    for await (const c of github.paginate<ApiCommit>(repoPath + '/commits', { sha: target })) {
      if (commits.length === MAX_INITIAL_COMMITS) {
        log.warning(`Only the latest ${MAX_INITIAL_COMMITS} commits were analyzed`);
        break;
      }
      commits.push(toCommit(c));
    }
    return { status: 'initial', commits: commits.reverse() };
  }

  const base = await peel(github, repoPath, previous.object);
  let status = '';
  const commits: Commit[] = [];
  const pages = github.paginate<ApiCommit>(repoPath + path`/compare/${base}...${target}`, {}, (page) => {
    const data = page as { status: string; commits: ApiCommit[] };
    status ||= data.status;
    return data.commits;
  });
  for await (const c of pages) commits.push(toCommit(c));
  return { status, commits };
}

/** Resolves a ref object to its commit, following annotated tags. */
async function peel(github: GitHub, repoPath: string, object: GitObject): Promise<string> {
  let current = object;
  for (let depth = 0; current.type === 'tag'; depth++) {
    if (depth === 10) throw new Error('annotated tag chain is too deep');
    current = (await github.request<{ object: GitObject }>('GET', repoPath + path`/git/tags/${current.sha}`)).data.object;
  }
  if (current.type !== 'commit') throw new Error(`tag points to a ${current.type}, not a commit`);
  return current.sha;
}

/** Creates the tag; returns false when it already exists at the target. */
async function createTag(github: GitHub, repoPath: string, config: Config, tag: string): Promise<boolean> {
  let sha = config.target;
  if (config.annotated) {
    const body = { tag, message: config.message || tag, object: config.target, type: 'commit' };
    sha = (await github.request<{ sha: string }>('POST', `${repoPath}/git/tags`, { body, idempotent: true })).data.sha;
  }
  const created = await github.request<{ message?: string }>('POST', `${repoPath}/git/refs`, {
    body: { ref: `refs/tags/${tag}`, sha },
    allowStatus: [422],
    idempotent: true,
  });
  if (created.status !== 422) return true;

  const existing = await github.request<{ object: GitObject }>('GET', repoPath + path`/git/ref/tags/${tag}`, { allowStatus: [404] });
  if (existing.status === 404) throw new Error(`could not create ${tag}: ${created.data.message ?? 'unprocessable'}`);
  const commit = await peel(github, repoPath, existing.data.object);
  if (commit !== config.target) throw new Error(`${tag} already exists at ${commit}, not ${config.target}`);
  return false;
}
