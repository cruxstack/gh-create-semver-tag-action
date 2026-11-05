// Conventional Commits parsing, bump rules and changelog rendering.
import { BUMPS, maxBump } from './semver.js';
export const DEFAULT_RULES = [
    { type: 'feat', bump: 'minor', section: 'Features' },
    { type: 'fix', bump: 'patch', section: 'Bug Fixes' },
    { type: 'perf', bump: 'patch', section: 'Performance Improvements' },
    { type: 'revert', bump: 'patch', section: 'Reverts' },
];
/** Parses `type:bump[:Section]` lines. */
export function parseRules(lines) {
    return lines.map((line) => {
        const m = /^([^:]*):([^:]*)(?::(.*))?$/.exec(line);
        const type = m?.[1]?.trim() ?? '';
        const bump = m?.[2]?.trim() ?? '';
        if (!/^[a-z][\w-]*$/i.test(type))
            throw new Error(`bump rule '${line}' has an invalid type`);
        if (!BUMPS.includes(bump))
            throw new Error(`bump rule '${line}' must use one of ${BUMPS.join(', ')}`);
        const section = m?.[3]?.trim() ?? '';
        return { type: type.toLowerCase(), bump: bump, ...(section ? { section } : {}) };
    });
}
/** Overrides rules by type; new types are appended. */
export function mergeRules(base, overrides) {
    const merged = new Map(base.map((r) => [r.type, r]));
    for (const rule of overrides)
        merged.set(rule.type, rule);
    return [...merged.values()];
}
const HEADER = /^([a-z][\w-]*)(?:\(([^()\r\n]+)\))?(!)?: +(\S.*)$/i;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
export function parseCommit(commit) {
    const [header = '', ...body] = commit.message.split(/\r?\n/);
    const m = HEADER.exec(header.trim());
    if (!m)
        return undefined;
    return {
        ...commit,
        type: m[1].toLowerCase(),
        ...(m[2] ? { scope: m[2].trim() } : {}),
        subject: m[4].trim(),
        breaking: m[3] === '!' || BREAKING_FOOTER.test(body.join('\n')),
    };
}
export function analyze(commits, rules) {
    const byType = new Map(rules.map((r) => [r.type, r]));
    let bump = 'none';
    let matched = false;
    const parsed = [];
    for (const commit of commits) {
        const p = parseCommit(commit);
        if (!p)
            continue;
        parsed.push(p);
        const rule = byType.get(p.type);
        if (p.breaking)
            bump = 'major';
        else if (rule)
            bump = maxBump(bump, rule.bump);
        matched ||= p.breaking || rule !== undefined;
    }
    return { bump, matched, commits: parsed };
}
export function renderChangelog(commits, rules, compareUrl) {
    const line = (c) => {
        const short = c.sha.slice(0, 7);
        return `- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject} (${c.url ? `[${short}](${c.url})` : short})`;
    };
    const newestFirst = [...commits].reverse();
    const sections = [];
    const breaking = newestFirst.filter((c) => c.breaking);
    if (breaking.length)
        sections.push(`### Breaking Changes\n\n${breaking.map(line).join('\n')}`);
    const headings = new Map();
    for (const rule of rules) {
        if (rule.section && !headings.has(rule.section))
            headings.set(rule.section, []);
    }
    const sectionOf = new Map(rules.map((r) => [r.type, r.section]));
    for (const c of newestFirst) {
        const section = sectionOf.get(c.type);
        if (section)
            headings.get(section).push(c);
    }
    for (const [heading, entries] of headings) {
        if (entries.length)
            sections.push(`### ${heading}\n\n${entries.map(line).join('\n')}`);
    }
    if (compareUrl)
        sections.push(`**Full Changelog**: ${compareUrl}`);
    return sections.join('\n\n');
}
