export type Bump = 'none' | 'patch' | 'minor' | 'major';

export const BUMPS: readonly Bump[] = ['none', 'patch', 'minor', 'major'];

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
  build: readonly string[];
}

const ID = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(
  `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${ID}(?:\\.${ID})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`,
);

export function parseVersion(text: string): Version | undefined {
  const m = SEMVER.exec(text);
  if (!m) return undefined;
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major, minor, patch, prerelease: m[4]?.split('.') ?? [], build: m[5]?.split('.') ?? [] };
}

export function formatVersion(v: Version): string {
  let text = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length) text += `-${v.prerelease.join('.')}`;
  if (v.build.length) text += `+${v.build.join('.')}`;
  return text;
}

/** SemVer precedence; build metadata is ignored. */
export function compareVersions(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core) return Math.sign(core);
  if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Math.sign(Number(x) - Number(y));
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function bumpVersion(v: Version, bump: Bump): Version {
  const base = { prerelease: [], build: [] };
  switch (bump) {
    case 'major':
      return { ...base, major: v.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { ...base, major: v.major, minor: v.minor + 1, patch: 0 };
    case 'patch':
      return { ...base, major: v.major, minor: v.minor, patch: v.patch + 1 };
    case 'none':
      return v;
  }
}

export const maxBump = (a: Bump, b: Bump): Bump => (BUMPS.indexOf(a) >= BUMPS.indexOf(b) ? a : b);
