import type {
  Timeline,
  Track,
  TrackItem,
  Clip,
  Gap,
  Transition,
  Marker,
  MediaReference,
  Metadata,
  Rational,
} from "../types.js"
import { ZERO } from "../time.js"
import { validateTimeline } from "../validate.js"
import { toFileUrl } from "../file-url.js"

interface OTIORationalTime {
  OTIO_SCHEMA: "RationalTime.1"
  rate: number
  value: number
}

interface OTIOTimeRange {
  OTIO_SCHEMA: "TimeRange.1"
  start_time: OTIORationalTime
  duration: OTIORationalTime
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloneMetadata(metadata?: Metadata): Metadata {
  return metadata ? structuredClone(metadata) : {}
}

function withPackageNamespace(
  metadata: Metadata | undefined,
  packageData: Record<string, unknown>,
): Metadata {
  const next = cloneMetadata(metadata)
  const existing = isRecord(next["@chatoctopus/timeline"])
    ? (next["@chatoctopus/timeline"] as Record<string, unknown>)
    : {}

  next["@chatoctopus/timeline"] = {
    ...existing,
    ...packageData,
  }

  return next
}

function normalizeTargetUrl(targetUrl: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(targetUrl)) {
    return targetUrl
  }
  return toFileUrl(targetUrl)
}

function toRationalTime(r: Rational, frameRate: Rational): OTIORationalTime {
  const rateFloat = frameRate.num / frameRate.den
  const frames = Math.round((r.num * frameRate.num) / (r.den * frameRate.den))

  return {
    OTIO_SCHEMA: "RationalTime.1",
    rate: rateFloat,
    value: frames,
  }
}

function toTimeRange(startTime: Rational, duration: Rational, frameRate: Rational): OTIOTimeRange {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: toRationalTime(startTime, frameRate),
    duration: toRationalTime(duration, frameRate),
  }
}

function mediaReferenceFrameRate(
  mediaReference: MediaReference,
  fallbackFrameRate: Rational,
): Rational {
  if (mediaReference.type === "external" && mediaReference.streamInfo?.frameRate) {
    return mediaReference.streamInfo.frameRate
  }

  return fallbackFrameRate
}

function buildMarker(marker: Marker, frameRate: Rational) {
  return {
    OTIO_SCHEMA: "Marker.2",
    name: marker.name ?? "",
    metadata: cloneMetadata(marker.metadata),
    marked_range: marker.markedRange
      ? toTimeRange(marker.markedRange.startTime, marker.markedRange.duration, frameRate)
      : null,
    color: marker.color ?? null,
  }
}

function buildMediaReference(mediaReference: MediaReference, frameRate: Rational) {
  const sourceFrameRate = mediaReferenceFrameRate(mediaReference, frameRate)

  if (mediaReference.type === "missing") {
    return {
      OTIO_SCHEMA: "MissingReference.1",
      metadata: cloneMetadata(mediaReference.metadata),
      name: mediaReference.name ?? "",
    }
  }

  const packageData: Record<string, unknown> = {}
  if (mediaReference.mediaKind && mediaReference.mediaKind !== "unknown") {
    packageData.mediaKind = mediaReference.mediaKind
  }
  if (mediaReference.streamInfo) {
    packageData.streamInfo = mediaReference.streamInfo
  }

  return {
    OTIO_SCHEMA: "ExternalReference.1",
    available_range: mediaReference.availableRange
      ? toTimeRange(
          mediaReference.availableRange.startTime,
          mediaReference.availableRange.duration,
          sourceFrameRate,
        )
      : null,
    target_url: normalizeTargetUrl(mediaReference.targetUrl),
    metadata: withPackageNamespace(mediaReference.metadata, packageData),
    name: mediaReference.name ?? "",
  }
}

function buildClip(clip: Clip, frameRate: Rational) {
  const sourceFrameRate = mediaReferenceFrameRate(clip.mediaReference, frameRate)

  return {
    OTIO_SCHEMA: "Clip.2",
    name: clip.name,
    source_range: clip.sourceRange
      ? toTimeRange(clip.sourceRange.startTime, clip.sourceRange.duration, sourceFrameRate)
      : null,
    media_references: {
      DEFAULT_MEDIA: buildMediaReference(clip.mediaReference, frameRate),
    },
    active_media_reference_key: "DEFAULT_MEDIA",
    effects: [],
    markers: (clip.markers ?? []).map((marker) => buildMarker(marker, frameRate)),
    metadata: cloneMetadata(clip.metadata),
    enabled: clip.enabled !== false,
    color: null,
  }
}

function buildGap(gap: Gap, frameRate: Rational) {
  return {
    OTIO_SCHEMA: "Gap.1",
    name: "",
    source_range: toTimeRange(gap.sourceRange.startTime, gap.sourceRange.duration, frameRate),
    effects: [],
    markers: [],
    metadata: cloneMetadata(gap.metadata),
    enabled: gap.enabled !== false,
    color: null,
  }
}

function buildTransition(transition: Transition, frameRate: Rational) {
  return {
    OTIO_SCHEMA: "Transition.1",
    name: transition.name ?? "",
    transition_type: transition.transitionType ?? "SMPTE_Dissolve",
    in_offset: toRationalTime(transition.inOffset, frameRate),
    out_offset: toRationalTime(transition.outOffset, frameRate),
    metadata: cloneMetadata(transition.metadata),
  }
}

function buildTrackItem(item: TrackItem, frameRate: Rational) {
  switch (item.kind) {
    case "clip":
      return buildClip(item, frameRate)
    case "gap":
      return buildGap(item, frameRate)
    case "transition":
      return buildTransition(item, frameRate)
  }
}

function buildTrack(track: Track, frameRate: Rational) {
  const kind = track.kind === "video" ? "Video" : "Audio"

  return {
    OTIO_SCHEMA: "Track.1",
    name: track.name ?? `${kind} Track`,
    kind,
    children: track.items.map((item) => buildTrackItem(item, frameRate)),
    source_range: null,
    effects: [],
    markers: (track.markers ?? []).map((marker) => buildMarker(marker, frameRate)),
    metadata: cloneMetadata(track.metadata),
    enabled: track.enabled !== false,
    color: null,
  }
}

/**
 * Generate an OpenTimelineIO (.otio) JSON string from a timeline.
 */
export function writeOTIO(timeline: Timeline): string {
  const errors = validateTimeline(timeline)
  const hardErrors = errors.filter((e) => e.type === "error")
  if (hardErrors.length > 0) {
    throw new Error(
      `Timeline validation failed:\n${hardErrors.map((e) => `  - ${e.message}`).join("\n")}`,
    )
  }
  const frameRate = timeline.format.frameRate

  const otioTimeline = {
    OTIO_SCHEMA: "Timeline.1",
    name: timeline.name,
    global_start_time: toRationalTime(timeline.globalStartTime ?? ZERO, frameRate),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: timeline.tracks.map((track) => buildTrack(track, frameRate)),
      source_range: null,
      effects: [],
      markers: (timeline.markers ?? []).map((marker) => buildMarker(marker, frameRate)),
      metadata: {},
      enabled: true,
      color: null,
    },
    metadata: withPackageNamespace(timeline.metadata, {
      format: {
        width: timeline.format.width,
        height: timeline.format.height,
        audioRate: timeline.format.audioRate,
        audioChannels: timeline.format.audioChannels ?? null,
        audioLayout: timeline.format.audioLayout ?? null,
        colorSpace: timeline.format.colorSpace ?? null,
      },
    }),
  }

  return JSON.stringify(otioTimeline, null, 2) + "\n"
}
