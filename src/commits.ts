// Conventional Commits parsing, bump rules and changelog rendering.
import { BUMPS, maxBump, type Bump } from './semver.ts';

export interface Rule {
  type: string;
  bump: Bump;
  /** Changelog heading; commits are omitted from the changelog when unset. */
  section?: string;
}

export interface Commit {
  sha: string;
  message: string;
  url?: string;
}

export interface ParsedCommit extends Commit {
  type: string;
  scope?: string;
  subject: string;
  breaking: boolean;
}

export const DEFAULT_RULES: readonly Rule[] = [
  { type: 'feat', bump: 'minor', section: 'Features' },
  { type: 'fix', bump: 'patch', section: 'Bug Fixes' },
  { type: 'perf', bump: 'patch', section: 'Performance Improvements' },
  { type: 'revert', bump: 'patch', section: 'Reverts' },
];

/** Parses `type:bump[:Section]` lines. */
export function parseRules(lines: readonly string[]): Rule[] {
  return lines.map((line) => {
    const m = /^([^:]*):([^:]*)(?::(.*))?$/.exec(line);
    const type = m?.[1]?.trim() ?? '';
    const bump = m?.[2]?.trim() ?? '';
    if (!/^[a-z][\w-]*$/i.test(type)) throw new Error(`bump rule '${line}' has an invalid type`);
    if (!BUMPS.includes(bump as Bump)) throw new Error(`bump rule '${line}' must use one of ${BUMPS.join(', ')}`);
    const section = m?.[3]?.trim() ?? '';
    return { type: type.toLowerCase(), bump: bump as Bump, ...(section ? { section } : {}) };
  });
}

/** Overrides rules by type; new types are appended. */
export function mergeRules(base: readonly Rule[], overrides: readonly Rule[]): Rule[] {
  const merged = new Map(base.map((r) => [r.type, r]));
  for (const rule of overrides) merged.set(rule.type, rule);
  return [...merged.values()];
}

const HEADER = /^([a-z][\w-]*)(?:\(([^()\r\n]+)\))?(!)?: +(\S.*)$/i;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;

export function parseCommit(commit: Commit): ParsedCommit | undefined {
  const [header = '', ...body] = commit.message.split(/\r?\n/);
  const m = HEADER.exec(header.trim());
  if (!m) return undefined;
  return {
    ...commit,
    type: m[1]!.toLowerCase(),
    ...(m[2] ? { scope: m[2].trim() } : {}),
    subject: m[4]!.trim(),
    breaking: m[3] === '!' || BREAKING_FOOTER.test(body.join('\n')),
  };
}

export interface Analysis {
  bump: Bump;
  /** Whether any commit matched a rule or was breaking. */
  matched: boolean;
  commits: ParsedCommit[];
}

export function analyze(commits: readonly Commit[], rules: readonly Rule[]): Analysis {
  const byType = new Map(rules.map((r) => [r.type, r]));
  let bump: Bump = 'none';
  let matched = false;
  const parsed: ParsedCommit[] = [];
  for (const commit of commits) {
    const p = parseCommit(commit);
    if (!p) continue;
    parsed.push(p);
    const rule = byType.get(p.type);
    if (p.breaking) bump = 'major';
    else if (rule) bump = maxBump(bump, rule.bump);
    matched ||= p.breaking || rule !== undefined;
  }
  return { bump, matched, commits: parsed };
}

export function renderChangelog(commits: readonly ParsedCommit[], rules: readonly Rule[], compareUrl?: string): string {
  const line = (c: ParsedCommit): string => {
    const short = c.sha.slice(0, 7);
    return `- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject} (${c.url ? `[${short}](${c.url})` : short})`;
  };
  const newestFirst = [...commits].reverse();
  const sections: string[] = [];
  const breaking = newestFirst.filter((c) => c.breaking);
  if (breaking.length) sections.push(`### Breaking Changes\n\n${breaking.map(line).join('\n')}`);
  const headings = new Map<string, ParsedCommit[]>();
  for (const rule of rules) {
    if (rule.section && !headings.has(rule.section)) headings.set(rule.section, []);
  }
  const sectionOf = new Map(rules.map((r) => [r.type, r.section]));
  for (const c of newestFirst) {
    const section = sectionOf.get(c.type);
    if (section) headings.get(section)!.push(c);
  }
  for (const [heading, entries] of headings) {
    if (entries.length) sections.push(`### ${heading}\n\n${entries.map(line).join('\n')}`);
  }
  if (compareUrl) sections.push(`**Full Changelog**: ${compareUrl}`);
  return sections.join('\n\n');
}
