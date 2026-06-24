/**
 * Textual sanitizer for NLE project files shared as test fixtures.
 *
 * Real exports from Final Cut Pro, Premiere, and Resolve embed absolute media
 * paths (which leak the author's username, drive layout, and often client or
 * project names). This rewrites every file path to a neutral placeholder while
 * leaving the rest of the document byte-for-byte intact -- so transitions,
 * markers, multicam, and container elements are preserved for testing.
 *
 * It deliberately works on the raw text rather than importing and re-exporting,
 * because the import/export round-trip is lossy and would strip the very edge
 * cases a contributed fixture is meant to capture.
 *
 * Paths are the only thing scrubbed automatically. Project names, clip names,
 * and marker text can also carry private information and must be reviewed by
 * hand -- the CLI prints a reminder to that effect.
 */

export interface SanitizeMapping {
  from: string
  to: string
}

export interface SanitizeResult {
  /** The sanitized file content. */
  content: string
  /** Each distinct original path and the placeholder it was replaced with. */
  mappings: SanitizeMapping[]
}

// Matches, in priority order: file:// URLs, then bare absolute POSIX paths
// under common media roots, then Windows drive paths. The `[^\s"'<>]+` body
// stops at the surrounding XML/JSON delimiters.
const PATH_PATTERN =
  /(file:\/\/[^\s"'<>]+)|(\/(?:Users|Volumes|home|private|mnt|media)\/[^\s"'<>]+)|([A-Za-z]:[\\/][^\s"'<>]+)/g

// Already-sanitized placeholders, so running the tool twice is a no-op.
const PLACEHOLDER = /\/media\/clip-\d+(?:\.[a-z0-9]+)?$/i

function extensionOf(pathLike: string): string {
  const cleaned = pathLike.replace(/[)\].,;:]+$/, "")
  const base = cleaned.split(/[\\/]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0 || dot === base.length - 1) return ""
  const ext = base.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,6}$/.test(ext) ? ext : ""
}

/**
 * Replace every absolute media path in `raw` with a sequential placeholder
 * (`file:///media/clip-0001.mov`). The same source path always maps to the
 * same placeholder, preserving the file references that linked clips rely on.
 */
export function sanitizeContent(raw: string): SanitizeResult {
  const seen = new Map<string, string>()
  let counter = 0

  const content = raw.replace(PATH_PATTERN, (match) => {
    if (PLACEHOLDER.test(match)) return match

    const existing = seen.get(match)
    if (existing) return existing

    counter += 1
    const id = String(counter).padStart(4, "0")
    const ext = extensionOf(match)
    const name = ext ? `clip-${id}.${ext}` : `clip-${id}`
    const placeholder = match.startsWith("file://")
      ? `file:///media/${name}`
      : `/media/${name}`

    seen.set(match, placeholder)
    return placeholder
  })

  return {
    content,
    mappings: [...seen.entries()].map(([from, to]) => ({ from, to })),
  }
}
