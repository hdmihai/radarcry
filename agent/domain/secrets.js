/**
 * SECRETS — the patterns that must never appear in anything the agent publishes: the report, the
 * snapshot files it checks, a chat answer or a code patch it proposes. Pure.
 */

/** Patterns that must never appear in a published file. */
export const SECRET_PATTERNS = Object.freeze([
  { id: 'url-key', re: /[?&](?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|key|token)=[A-Za-z0-9_-]{16,}/i },
  { id: 'coingecko-key', re: /\bCG-[A-Za-z0-9]{20,}\b/ },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { id: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/ },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]);

export function scanSecrets(files) {
  const leaks = [];
  let bytes = 0;
  for (const f of files ?? []) {
    const text = String(f.text ?? '');
    bytes += text.length;
    for (const p of SECRET_PATTERNS) if (p.re.test(text)) leaks.push({ file: f.name, pattern: p.id });
  }
  return { files: (files ?? []).length, bytesKb: Math.round(bytes / 1024), leaks };
}
