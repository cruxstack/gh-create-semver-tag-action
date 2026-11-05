# gh-create-semver-tag-action

Calculates the next semantic version from [Conventional Commits](https://www.conventionalcommits.org)
and creates the tag through the GitHub API. No checkout or git history is required.

- Reads every version tag in one paginated query, so there is no tag-count limit.
- Measures from the merge base with the previous release, so tags on other release lines (hotfixes)
  don't skew the result.
- Tag creation is atomic and idempotent: re-running on the same commit succeeds, while a tag that
  already points elsewhere fails the step.
- No runtime dependencies. The token is only ever sent to the GitHub API.

## Usage

```yaml
on:
  push:
    branches: [main]

permissions: {}

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - id: tag
        uses: cruxstack/gh-create-semver-tag-action@<full-commit-sha> # v1.0.0

      - if: steps.tag.outputs.tag-created == 'true'
        env:
          TAG: ${{ steps.tag.outputs.tag }}
        run: echo "Released $TAG"
```

Pin the action to a full commit SHA. Release tags are immutable.

## Inputs

| Name | Default | Description |
|---|---|---|
| `github-token` | `github.token` | Token with `contents: write` (`contents: read` for dry runs). |
| `github-repository` | `github.repository` | Repository to tag, as `owner/name`. |
| `tag-prefix` | `v` | Prefix placed before the version. |
| `tag-target` | `github.sha` | Full commit SHA to tag. |
| `tag-custom` | | Exact version to use instead of calculating one. The prefix is optional. |
| `tag-annotated` | `false` | Create an annotated tag. |
| `tag-message` | tag name | Annotated tag message. |
| `bump-rules` | | `type:bump[:Changelog Section]` entries, one per line or comma-separated. |
| `bump-default` | `patch` | Bump when no commit matches a rule: `major`, `minor`, `patch` or `none`. |
| `bump-minimum` | `none` | Smallest bump applied when a release happens. |
| `dry-run` | `false` | Calculate only; don't create the tag. |

## Outputs

| Name | Description |
|---|---|
| `tag` | New tag, e.g. `v1.2.0`. Empty when no release is needed. |
| `version` | New version without the prefix. |
| `previous-tag` | Latest version tag before this one. |
| `previous-version` | Latest version before this one. |
| `bump` | `major`, `minor`, `patch`, `none` or `custom`. |
| `changelog` | Markdown changelog of commits since the previous tag. |
| `tag-created` | Whether this run created the tag. |

## How the version is calculated

1. The previous version is the highest stable SemVer tag that starts with `tag-prefix`. With
   `tag-custom`, it is the highest one below the custom version.
2. Commits between the previous version and `tag-target` are parsed as Conventional Commits.
   A `!` after the type or a `BREAKING CHANGE:` footer always means `major`.
3. The bump is the largest one any commit matches. When no commit matches a rule, `bump-default`
   applies. A release is then raised to at least `bump-minimum`.
4. If `tag-target` is already the previous version's commit, that tag is returned with
   `bump: none` and `tag-created: false`, so re-runs are safe.
5. Without a previous tag, versioning starts from `0.0.0` and the latest 1,000 commits are analyzed.

Default rules, which `bump-rules` entries override by type:

| Type | Bump | Changelog section |
|---|---|---|
| `feat` | minor | Features |
| `fix` | patch | Bug Fixes |
| `perf` | patch | Performance Improvements |
| `revert` | patch | Reverts |

Use `none` to list a type in the changelog without releasing it, e.g. `docs:none:Documentation`.
Rules without a section are left out of the changelog.

## Development

```sh
npm ci
npm test           # builds, then runs all tests offline
npm run coverage   # tests with coverage thresholds
```

Commit `dist/` together with source changes; CI fails when it is stale.

## License

[MIT](LICENSE)

## Acknowledgements

Thanks to [mathieudutour/github-tag-action](https://github.com/mathieudutour/github-tag-action),
which inspired this action.
