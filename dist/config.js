import { isCommitSha, parseRepository } from './lib/refname.js';
import { DEFAULT_RULES, mergeRules, parseRules } from './commits.js';
import { BUMPS, parseVersion } from './semver.js';
export function readConfig(inputs, env) {
    const prefix = inputs.get('tag-prefix');
    if (!/^[A-Za-z0-9._/-]{0,64}$/.test(prefix))
        throw new Error(`tag-prefix '${prefix}' has unsupported characters`);
    const target = inputs.required('tag-target');
    if (!isCommitSha(target))
        throw new Error(`tag-target '${target}' must be a full commit SHA`);
    const customText = inputs.get('tag-custom');
    const unprefixed = prefix && customText.startsWith(prefix) ? customText.slice(prefix.length) : customText;
    const custom = customText ? parseVersion(unprefixed) : undefined;
    if (customText && !custom)
        throw new Error(`tag-custom '${customText}' is not a semantic version`);
    return {
        token: inputs.required('github-token'),
        ...parseRepository(inputs.required('github-repository')),
        serverUrl: (env['GITHUB_SERVER_URL'] || 'https://github.com').replace(/\/+$/, ''),
        prefix,
        target,
        custom,
        annotated: inputs.boolean('tag-annotated', false),
        message: inputs.get('tag-message'),
        rules: mergeRules(DEFAULT_RULES, parseRules(inputs.list('bump-rules', { commas: true }))),
        bumpDefault: inputs.choice('bump-default', BUMPS, 'patch'),
        bumpMinimum: inputs.choice('bump-minimum', BUMPS, 'none'),
        dryRun: inputs.boolean('dry-run', false),
    };
}
