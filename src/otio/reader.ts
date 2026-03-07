import type {
  NLETimeline,
  NLEClip,
  NLEAsset,
  NLETrack,
  NLEFormat,
  ImportResult,
} from "../types.js"
import { rational, ZERO, add } from "../time.js"
import { createHash } from "node:crypto"

function ensureArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  return []
}

function fileUrlToPath(url: string): string {
  if (url.startsWith("file://")) return decodeURIComponent(url.slice(7))
  return url
}

function rateToRational(rate: number): { num: number; den: number } {
  if (Math.abs(rate - Math.round(rate)) < 0.01) {
    return { num: Math.round(rate), den: 1 }
  }
  const ntscRates: [number, number, number][] = [
    [23.976, 24000, 1001],
    [29.97, 30000, 1001],
    [47.952, 48000, 1001],
    [59.94, 60000, 1001],
  ]
  for (const [approx, num, den] of ntscRates) {
    if (Math.abs(rate - approx) < 0.05) return { num, den }
  }
  return { num: Math.round(rate * 1000), den: 1000 }
}

function parseRationalTime(rt: any): { num: number; den: number } {
  if (!rt || rt.OTIO_SCHEMA !== "RationalTime.1") return ZERO
  const rate = rt.rate ?? 24
  const value = Math.round(rt.value ?? 0)
  const rateRat = rateToRational(rate)
  return rational(value * rateRat.den, rateRat.num)
}

function rateFromRationalTime(rt: any): number {
  return rt?.rate ?? 24
}

/**
 * Parse an OpenTimelineIO (.otio) JSON string into an NLETimeline.
 */
export function readOTIO(jsonString: string): ImportResult {
  const warnings: string[] = []

  let parsed: any
  try {
    parsed = JSON.parse(jsonString)
  } catch {
    throw new Error("Invalid OTIO: failed to parse JSON")
  }

  if (parsed.OTIO_SCHEMA !== "Timeline.1") {
    throw new Error(
      `Unsupported OTIO top-level schema: "${parsed.OTIO_SCHEMA}". Expected "Timeline.1".`,
    )
  }

  const name = parsed.name ?? "Untitled"
  const globalRate = rateFromRationalTime(parsed.global_start_time)

  const otioMeta = parsed.metadata?.["@chatoctopus/timeline"]?.format
  const width = otioMeta?.width ?? 1920
  const height = otioMeta?.height ?? 1080
  const audioRate = otioMeta?.audioRate ?? 48000
  const colorSpace = otioMeta?.colorSpace ?? undefined

  const frameRateRational = rational(Math.round(globalRate * 1000), 1000)
  const isNearNTSC = (r: number) =>
    Math.abs(r - 23.976) < 0.01 ||
    Math.abs(r - 29.97) < 0.01 ||
    Math.abs(r - 59.94) < 0.01

  let frameRate = frameRateRational
  if (isNearNTSC(globalRate)) {
    const nominal = Math.round(globalRate)
    frameRate = rational(nominal * 1000, 1001)
  } else if (globalRate === Math.round(globalRate)) {
    frameRate = rational(Math.round(globalRate), 1)
  }

  const format: NLEFormat = {
    width,
    height,
    frameRate,
    audioRate,
    colorSpace,
  }

  const assetMap = new Map<string, NLEAsset>()
  const tracks: NLETrack[] = []
  const assetCounter = { value: 0 }

  const stack = parsed.tracks
  if (stack?.OTIO_SCHEMA === "Stack.1") {
    const otioTracks = ensureArray(stack.children)
    for (const ot of otioTracks) {
      const track = parseTrack(
        ot as any,
        globalRate,
        format,
        assetMap,
        warnings,
        assetCounter,
      )
      if (track) tracks.push(track)
    }
  }

  return {
    timeline: {
      name,
      format,
      tracks,
      assets: Array.from(assetMap.values()),
    },
    warnings,
  }
}

function parseTrack(
  ot: any,
  globalRate: number,
  format: NLEFormat,
  assetMap: Map<string, NLEAsset>,
  warnings: string[],
  assetCounter: { value: number },
): NLETrack | null {
  if (ot?.OTIO_SCHEMA !== "Track.1") {
    warnings.push(`Skipping non-Track child with schema: ${ot?.OTIO_SCHEMA}`)
    return null
  }

  const kind = ot.kind ?? "Video"
  const trackType: "video" | "audio" = kind === "Audio" ? "audio" : "video"
  const children = ensureArray(ot.children)

  const clips: NLEClip[] = []
  let currentOffset = ZERO

  for (const child of children) {
    const c = child as any
    const schema = c.OTIO_SCHEMA ?? ""

    if (schema.startsWith("Gap.")) {
      const gapRange = c.source_range
      if (gapRange) {
        const gapDur = parseRationalTime(gapRange.duration)
        currentOffset = add(currentOffset, gapDur)
      }
      continue
    }

    if (schema.startsWith("Clip.")) {
      const { clip, asset } = parseClip(
        c,
        currentOffset,
        globalRate,
        format,
        warnings,
        assetCounter,
      )
      if (clip) {
        clips.push(clip)
        if (asset && !assetMap.has(asset.id)) {
          assetMap.set(asset.id, asset)
        }
        currentOffset = add(clip.offset, clip.duration)
      }
      continue
    }

    if (schema.startsWith("Transition.")) {
      warnings.push(
        `Transitions are not yet supported (skipping "${c.name ?? "unnamed"}")`,
      )
      continue
    }

    warnings.push(`Skipping unknown element with schema: ${schema}`)
  }

  return { type: trackType, clips }
}

function deterministicHash(str: string): string {
  return createHash("md5").update(str).digest("hex").slice(0, 12)
}

function parseClip(
  c: any,
  offset: { num: number; den: number },
  globalRate: number,
  format: NLEFormat,
  warnings: string[],
  assetCounter: { value: number },
): { clip: NLEClip | null; asset: NLEAsset | null } {
  const sourceRange = c.source_range
  if (!sourceRange) {
    warnings.push(`Clip "${c.name ?? "unknown"}" has no source_range`)
    return { clip: null, asset: null }
  }

  const rate = rateFromRationalTime(sourceRange.start_time) || globalRate
  const sourceIn = parseRationalTime(sourceRange.start_time)
  const duration = parseRationalTime(sourceRange.duration)

  const mediaRef =
    c.media_references?.[c.active_media_reference_key ?? "DEFAULT_MEDIA"] ??
    c.media_reference

  let asset: NLEAsset | null = null
  const idx = ++assetCounter.value
  let assetId = `otio-asset-${idx}`

  if (mediaRef?.OTIO_SCHEMA === "ExternalReference.1") {
    const targetUrl = mediaRef.target_url ?? ""
    const path = fileUrlToPath(targetUrl)
    assetId = `r-${deterministicHash(path)}`

    const availRange = mediaRef.available_range
    const assetDuration = availRange
      ? parseRationalTime(availRange.duration)
      : duration
    const assetStart = availRange
      ? parseRationalTime(availRange.start_time)
      : ZERO

    asset = {
      id: assetId,
      name: mediaRef.name || path.split("/").pop() || "",
      path,
      duration: assetDuration,
      hasVideo: true,
      hasAudio: true,
      videoFormat: format,
      audioChannels: 2,
      audioRate: format.audioRate,
      timecodeStart: assetStart,
    }
  } else if (mediaRef?.OTIO_SCHEMA === "MissingReference.1") {
    assetId = `otio-missing-${idx}`
    warnings.push(`Clip "${c.name ?? "unknown"}" has a missing media reference`)
  }

  const clip: NLEClip = {
    assetId,
    name: c.name ?? "",
    offset,
    duration,
    sourceIn,
    sourceDuration: duration,
    enabled: c.enabled !== false,
  }

  return { clip, asset }
}
