/**
 * Defines source paths that remain in the private archive and never enter the
 * fresh public PixieCore repository.
 */
export const PRIVATE_ARCHIVE_PREFIXES = Object.freeze([
  'benchmarks/evidence/',
  'benchmarks/results/',
  'conformance/evidence/',
  'docs/internal/',
  'docs/project/pixiecore/',
]);

/** Individual planning files retained only in the private source archive. */
export const PRIVATE_ARCHIVE_PATHS = Object.freeze([
  'docs/project/backlog.md',
]);

/** Paths that cannot be published even when they accidentally become tracked. */
export const FORBIDDEN_PUBLIC_PATH_PARTS = Object.freeze([
  '.env',
  '.git',
  '.pixiecore',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

/** Product and predecessor names prohibited by the approved hard-cut policy. */
export const FORBIDDEN_PRODUCT_NAMES = Object.freeze([
  Object.freeze({ id: 'old-codename', pattern: new RegExp(['type', 'core'].join(''), 'iu') }),
  Object.freeze({ id: 'predecessor-name', pattern: new RegExp(['frac', 'tone'].join(''), 'iu') }),
]);

/** High-confidence secret forms that can be detected without printing values. */
export const SECRET_PATTERNS = Object.freeze([
  Object.freeze({ id: 'openai-api-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u }),
  Object.freeze({ id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u }),
  Object.freeze({ id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u }),
  Object.freeze({ id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u }),
  Object.freeze({ id: 'private-key', pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u }),
]);

/** Machine-local path forms that are not valid public source content. */
export const PRIVATE_PATH_PATTERNS = Object.freeze([
  Object.freeze({ id: 'macos-user-path', pattern: /\/Users\/[^/\s]+\//u }),
  Object.freeze({ id: 'unix-user-path', pattern: /\/home\/[^/\s]+\//u }),
  Object.freeze({ id: 'windows-user-path', pattern: /[A-Za-z]:\\Users\\[^\\\s]+\\/u }),
  Object.freeze({ id: 'cloud-storage-path', pattern: /(?:OneDrive|Mobile Documents)[/\\]/iu }),
]);

/** Returns true when a tracked path belongs only to the private archive. */
export function isPrivateArchivePath(path) {
  return PRIVATE_ARCHIVE_PATHS.includes(path)
    || PRIVATE_ARCHIVE_PREFIXES.some(prefix => path.startsWith(prefix));
}

/** Rejects forbidden path parts, including every environment-file variant. */
export function hasForbiddenPublicPathPart(path) {
  const parts = path.split('/');
  return parts.some(part => FORBIDDEN_PUBLIC_PATH_PARTS.includes(part) || part.startsWith('.env.'));
}
