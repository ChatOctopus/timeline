import type {
  Timeline,
  Track,
  TrackItem,
  Clip,
  Gap,
  Transition,
  Marker,
  MediaReference,
  ExternalReference,
  MissingReference,
  Metadata,
  NLEFormat,
  ImportResult,
  Rational,
  MediaKind,
  StreamInfo,
} from "../types.js"
import { DEFAULT_FORMAT, resolveFormatDefaults } from "../defaults.js"
import { rational, ZERO } from "../time.js"
import { inferMediaKindFromTarget } from "../media-kind.js"

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloneMetadata(value: unknown): Metadata | undefined {
  return isRecord(value) ? structuredClone(value) : undefined
}

function stripPackageNamespace(metadata: Metadata | undefined): Metadata | undefined {
  if (!metadata) return undefined
  const next = structuredClone(metadata)
  delete next["@chatoctopus/timeline"]
  return Object.keys(next).length > 0 ? next : undefined
}

function packageNamespace(metadata: Metadata | undefined): Record<string, unknown> {
  if (!metadata) return {}
  return isRecord(metadata["@chatoctopus/timeline"])
    ? (metadata["@chatoctopus/timeline"] as Record<string, unknown>)
    : {}
}

function rateToRational(rate: number): Rational {
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

  return rational(Math.round(rate * 1000), 1000)
}

function parseRationalTime(rt: any): Rational {
  if (!rt || rt.OTIO_SCHEMA !== "RationalTime.1") return ZERO
  const rate = rt.rate ?? 24
  const value = Math.round(rt.value ?? 0)
  const rateRat = rateToRational(rate)
  return rational(value * rateRat.den, rateRat.num)
}

function parseTimeRange(value: any): { startTime: Rational; duration: Rational } | undefined {
  if (!value || value.OTIO_SCHEMA !== "TimeRange.1") return undefined

  return {
    startTime: parseRationalTime(value.start_time),
    duration: parseRationalTime(value.duration),
  }
}

function rateFromRationalTime(rt: any): number {
  return rt?.rate ?? 24
}

function parseMarkers(value: unknown, warnings: string[], context: string): Marker[] | undefined {
  const markers = ensureArray(value)
  const parsed: Marker[] = []

  for (const raw of markers) {
    const marker = raw as any
    if (marker?.OTIO_SCHEMA !== "Marker.2") {
      warnings.push(`${context} contains unsupported marker schema: ${marker?.OTIO_SCHEMA ?? "unknown"}`)
      continue
    }

    parsed.push({
      name: marker.name || undefined,
      color: marker.color ?? null,
      metadata: stripPackageNamespace(cloneMetadata(marker.metadata)),
      markedRange: parseTimeRange(marker.marked_range),
    })
  }

  return parsed.length > 0 ? parsed : undefined
}

function warnOnEffects(value: any, warnings: string[], context: string): void {
  const effects = ensureArray(value?.effects)
  if (effects.length > 0) {
    warnings.push(`${context} effects are not supported and were dropped`)
  }
}

function parseStreamInfo(value: unknown): StreamInfo | undefined {
  if (!isRecord(value)) return undefined

  const frameRateValue = value.frameRate
  const frameRate = isRecord(frameRateValue) &&
    typeof frameRateValue.num === "number" &&
    typeof frameRateValue.den === "number"
    ? { num: frameRateValue.num, den: frameRateValue.den }
    : undefined

  return {
    hasVideo: typeof value.hasVideo === "boolean" ? value.hasVideo : undefined,
    hasAudio: typeof value.hasAudio === "boolean" ? value.hasAudio : undefined,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
    frameRate,
    audioRate: typeof value.audioRate === "number" ? value.audioRate : undefined,
    audioChannels: typeof value.audioChannels === "number" ? value.audioChannels : undefined,
    colorSpace: typeof value.colorSpace === "string" ? value.colorSpace : undefined,
  }
}

function parseMediaReference(value: any, warnings: string[]): MediaReference {
  const metadata = cloneMetadata(value?.metadata)
  const namespace = packageNamespace(metadata)
  const cleanMetadata = stripPackageNamespace(metadata)

  if (value?.OTIO_SCHEMA === "MissingReference.1") {
    const reference: MissingReference = {
      type: "missing",
      name: value.name || undefined,
      metadata: cleanMetadata,
    }
    return reference
  }

  if (value?.OTIO_SCHEMA === "ExternalReference.1") {
    const targetUrl = value.target_url ?? ""
    const mediaKind = typeof namespace.mediaKind === "string"
      ? (namespace.mediaKind as MediaKind)
      : inferMediaKindFromTarget(targetUrl)

    const reference: ExternalReference = {
      type: "external",
      targetUrl,
      name: value.name || undefined,
      mediaKind,
      availableRange: parseTimeRange(value.available_range),
      metadata: cleanMetadata,
      streamInfo: parseStreamInfo(namespace.streamInfo),
    }
    return reference
  }

  warnings.push(`Unsupported media reference schema: ${value?.OTIO_SCHEMA ?? "unknown"}`)
  return {
    type: "missing",
    metadata: cleanMetadata,
  }
}

function parseClip(value: any, warnings: string[]): Clip {
  warnOnEffects(value, warnings, `Clip "${value?.name ?? "unknown"}"`)

  const mediaReference =
    value?.media_references?.[value.active_media_reference_key ?? "DEFAULT_MEDIA"] ??
    value?.media_reference

  return {
    kind: "clip",
    name: value?.name ?? "",
    mediaReference: parseMediaReference(mediaReference, warnings),
    sourceRange: parseTimeRange(value?.source_range),
    metadata: stripPackageNamespace(cloneMetadata(value?.metadata)),
    markers: parseMarkers(value?.markers, warnings, `Clip "${value?.name ?? "unknown"}"`),
    enabled: value?.enabled !== false,
  }
}

function parseGap(value: any, warnings: string[]): Gap {
  warnOnEffects(value, warnings, "Gap")

  return {
    kind: "gap",
    sourceRange: parseTimeRange(value?.source_range) ?? {
      startTime: ZERO,
      duration: ZERO,
    },
    metadata: stripPackageNamespace(cloneMetadata(value?.metadata)),
    enabled: value?.enabled !== false,
  }
}

function parseTransition(value: any): Transition {
  return {
    kind: "transition",
    name: value?.name || undefined,
    transitionType: value?.transition_type || undefined,
    inOffset: parseRationalTime(value?.in_offset),
    outOffset: parseRationalTime(value?.out_offset),
    metadata: stripPackageNamespace(cloneMetadata(value?.metadata)),
  }
}

function parseTrack(value: any, warnings: string[]): Track | null {
  if (value?.OTIO_SCHEMA !== "Track.1") {
    warnings.push(`Skipping non-Track child with schema: ${value?.OTIO_SCHEMA ?? "unknown"}`)
    return null
  }

  warnOnEffects(value, warnings, `Track "${value?.name ?? "unknown"}"`)

  const items: TrackItem[] = []
  for (const child of ensureArray(value.children)) {
    const schema = (child as any)?.OTIO_SCHEMA ?? ""

    if (schema.startsWith("Clip.")) {
      items.push(parseClip(child, warnings))
      continue
    }

    if (schema.startsWith("Gap.")) {
      items.push(parseGap(child, warnings))
      continue
    }

    if (schema.startsWith("Transition.")) {
      items.push(parseTransition(child))
      continue
    }

    warnings.push(`Skipping unknown track item with schema: ${schema}`)
  }

  return {
    kind: value.kind === "Audio" ? "audio" : "video",
    name: value.name || undefined,
    items,
    metadata: stripPackageNamespace(cloneMetadata(value.metadata)),
    markers: parseMarkers(value.markers, warnings, `Track "${value?.name ?? "unknown"}"`),
    enabled: value.enabled !== false,
  }
}

/**
 * Parse an OpenTimelineIO (.otio) JSON string into the OTIO-first Timeline model.
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

  warnOnEffects(parsed, warnings, `Timeline "${parsed.name ?? "Untitled"}"`)

  const metadata = cloneMetadata(parsed.metadata)
  const namespace = packageNamespace(metadata)
  const formatMeta = isRecord(namespace.format) ? namespace.format : {}
  const cleanMetadata = stripPackageNamespace(metadata)
  const globalRate = rateFromRationalTime(parsed.global_start_time)
  const frameRate = rateToRational(globalRate)

  const format: NLEFormat = resolveFormatDefaults({
    width: typeof formatMeta.width === "number" ? formatMeta.width : DEFAULT_FORMAT.width,
    height: typeof formatMeta.height === "number" ? formatMeta.height : DEFAULT_FORMAT.height,
    frameRate,
    audioRate: typeof formatMeta.audioRate === "number" ? formatMeta.audioRate : DEFAULT_FORMAT.audioRate,
    audioChannels: typeof formatMeta.audioChannels === "number" ? formatMeta.audioChannels : undefined,
    audioLayout: typeof formatMeta.audioLayout === "string" ? formatMeta.audioLayout : undefined,
    colorSpace: typeof formatMeta.colorSpace === "string" ? formatMeta.colorSpace : undefined,
  })

  const tracksStack = parsed.tracks
  const tracks = ensureArray(tracksStack?.children)
    .map((track) => parseTrack(track, warnings))
    .filter((track): track is Track => track !== null)

  const timeline: Timeline = {
    name: parsed.name ?? "Untitled",
    format,
    tracks,
    metadata: cleanMetadata,
    markers: parseMarkers(tracksStack?.markers, warnings, "Timeline"),
    globalStartTime: parseRationalTime(parsed.global_start_time),
  }

  return { timeline, warnings }
}
