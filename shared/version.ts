// Compare release versions like "0.3.0" or "v1.2.10". Pre-release tags ("1.0.0-beta") count as older than the release.
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const [core, pre] = version.trim().replace(/^v/i, '').split('-', 2)
    return { parts: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre: Boolean(pre) }
  }
  const a = parse(candidate), b = parse(current)
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0)
    if (diff) return diff > 0
  }
  return b.pre && !a.pre
}
