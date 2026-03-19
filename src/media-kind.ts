import type { MediaKind } from "./types.js"

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i
const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|aac|flac|ogg)$/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|mkv|avi|webm|mxf)$/i

function normalizeTarget(target: string): string {
  return target.split(/[?#]/, 1)[0]?.toLowerCase() ?? ""
}

export function inferMediaKindFromTarget(target: string): MediaKind {
  const normalized = normalizeTarget(target)

  if (IMAGE_EXTENSIONS.test(normalized)) return "image"
  if (AUDIO_EXTENSIONS.test(normalized)) return "audio"
  if (VIDEO_EXTENSIONS.test(normalized)) return "video"

  return "unknown"
}
