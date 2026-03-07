import type {
  NLETimeline,
  NLEClip,
  NLEAsset,
  NLETrack,
  Rational,
} from "../types.js"
import { toSeconds, isZero } from "../time.js"
import { validateTimeline, computeTimelineDuration } from "../validate.js"
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

function toRationalTime(
  r: Rational,
  frameRate: Rational,
): OTIORationalTime {
  const rateFloat = frameRate.num / frameRate.den
  const frames = Math.round(
    (r.num * frameRate.num) / (r.den * frameRate.den),
  )
  return {
    OTIO_SCHEMA: "RationalTime.1",
    rate: rateFloat,
    value: frames,
  }
}

function toTimeRange(
  startTime: Rational,
  duration: Rational,
  frameRate: Rational,
): OTIOTimeRange {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: toRationalTime(startTime, frameRate),
    duration: toRationalTime(duration, frameRate),
  }
}

function buildMediaReference(asset: NLEAsset, timelineFrameRate: Rational) {
  const assetRate = asset.videoFormat?.frameRate ?? timelineFrameRate

  return {
    OTIO_SCHEMA: "ExternalReference.1",
    available_range: toTimeRange(
      asset.timecodeStart ?? { num: 0, den: 1 },
      asset.duration,
      assetRate,
    ),
    target_url: toFileUrl(asset.path),
    metadata: {},
    name: asset.name,
  }
}

function buildClip(
  clip: NLEClip,
  asset: NLEAsset | undefined,
  timelineFrameRate: Rational,
) {
  const assetRate = asset?.videoFormat?.frameRate ?? timelineFrameRate

  const mediaRef = asset
    ? buildMediaReference(asset, timelineFrameRate)
    : { OTIO_SCHEMA: "MissingReference.1", metadata: {}, name: "" }

  return {
    OTIO_SCHEMA: "Clip.2",
    name: clip.name,
    source_range: toTimeRange(clip.sourceIn, clip.sourceDuration, assetRate),
    media_references: {
      DEFAULT_MEDIA: mediaRef,
    },
    active_media_reference_key: "DEFAULT_MEDIA",
    effects: [],
    markers: [],
    metadata: {},
    enabled: clip.enabled !== false,
    color: null,
  }
}

function buildGap(durationSeconds: number, frameRate: Rational) {
  const rateFloat = frameRate.num / frameRate.den
  return {
    OTIO_SCHEMA: "Gap.1",
    name: "",
    source_range: {
      OTIO_SCHEMA: "TimeRange.1",
      start_time: { OTIO_SCHEMA: "RationalTime.1", rate: rateFloat, value: 0 },
      duration: {
        OTIO_SCHEMA: "RationalTime.1",
        rate: rateFloat,
        value: Math.round(durationSeconds * rateFloat),
      },
    },
    effects: [],
    markers: [],
    metadata: {},
    enabled: true,
    color: null,
  }
}

function buildTrack(
  track: NLETrack,
  assetMap: Map<string, NLEAsset>,
  timelineFrameRate: Rational,
) {
  const sortedClips = [...track.clips].sort(
    (a, b) => a.offset.num / a.offset.den - b.offset.num / b.offset.den,
  )

  const children: unknown[] = []
  let currentTime = 0

  for (const clip of sortedClips) {
    const clipOffset = toSeconds(clip.offset)
    const clipDuration = toSeconds(clip.duration)

    if (clipOffset > currentTime + 0.0001) {
      children.push(buildGap(clipOffset - currentTime, timelineFrameRate))
    }

    const asset = assetMap.get(clip.assetId)
    children.push(buildClip(clip, asset, timelineFrameRate))
    currentTime = clipOffset + clipDuration
  }

  const kind = track.type === "video" ? "Video" : "Audio"

  return {
    OTIO_SCHEMA: "Track.1",
    name: `${kind} Track`,
    kind,
    children,
    source_range: null,
    effects: [],
    markers: [],
    metadata: {},
    enabled: true,
    color: null,
  }
}

/**
 * Generate an OpenTimelineIO (.otio) JSON string from an NLETimeline.
 */
export function writeOTIO(timeline: NLETimeline): string {
  const errors = validateTimeline(timeline)
  const hardErrors = errors.filter((e) => e.type === "error")
  if (hardErrors.length > 0) {
    throw new Error(
      `Timeline validation failed:\n${hardErrors.map((e) => `  - ${e.message}`).join("\n")}`,
    )
  }

  const timelineFrameRate = timeline.format.frameRate
  const rateFloat =
    timelineFrameRate.num / timelineFrameRate.den
  const assetMap = new Map(timeline.assets.map((a) => [a.id, a]))

  const tracks = timeline.tracks.map((t) =>
    buildTrack(t, assetMap, timelineFrameRate),
  )

  const globalStartTime: OTIORationalTime = {
    OTIO_SCHEMA: "RationalTime.1",
    rate: rateFloat,
    value: 0,
  }

  const otioTimeline = {
    OTIO_SCHEMA: "Timeline.1",
    name: timeline.name,
    global_start_time: globalStartTime,
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: tracks,
      source_range: null,
      effects: [],
      markers: [],
      metadata: {},
      enabled: true,
      color: null,
    },
    metadata: {
      "@chatoctopus/timeline": {
        format: {
          width: timeline.format.width,
          height: timeline.format.height,
          audioRate: timeline.format.audioRate,
          colorSpace: timeline.format.colorSpace ?? null,
        },
      },
    },
  }

  return JSON.stringify(otioTimeline, null, 2) + "\n"
}
