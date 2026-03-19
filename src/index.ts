export type {
  Rational,
  Metadata,
  TimeRange,
  MediaKind,
  StreamInfo,
  ExternalReference,
  MissingReference,
  MediaReference,
  Marker,
  Clip,
  Gap,
  Transition,
  TrackItem,
  Track,
  Timeline,
  NLETimeline,
  NLETrack,
  NLEClip,
  NLEAsset,
  NLEFormat,
  NLEEditor,
  NLEExportFormat,
  ClipInput,
  ExportOptions,
  ImportResult,
} from "./types.js"

export {
  rational,
  ZERO,
  add,
  subtract,
  subtractUnclamped,
  multiply,
  divide,
  toSeconds,
  toFCPString,
  parseFCPString,
  frameDuration,
  secondsToFrameAligned,
  roundToFrameBoundary,
  toFrames,
  nominalFrameRate,
  isNTSC,
  isDropFrame,
  parseTimecode,
  FRAME_RATES,
} from "./time.js"

export { probeAsset } from "./probe.js"

export {
  validateTimeline,
  hasErrors,
  computeTimelineDuration,
} from "./validate.js"
export type { ValidationError } from "./validate.js"

export { writeFCPXML } from "./fcpxml/writer.js"
export { readFCPXML } from "./fcpxml/reader.js"
export { writeXMEML } from "./xmeml/writer.js"
export { readXMEML } from "./xmeml/reader.js"
export { writeOTIO } from "./otio/writer.js"
export { readOTIO } from "./otio/reader.js"

import type {
  Timeline,
  NLETimeline,
  NLEEditor,
  NLEExportFormat,
  ExportOptions,
  ImportResult,
  ClipInput,
} from "./types.js"
import { writeFCPXML } from "./fcpxml/writer.js"
import { readFCPXML } from "./fcpxml/reader.js"
import { writeXMEML } from "./xmeml/writer.js"
import { readXMEML } from "./xmeml/reader.js"
import { writeOTIO } from "./otio/writer.js"
import { readOTIO } from "./otio/reader.js"
import { probeAsset } from "./probe.js"
import { coreToLegacyTimeline, isLegacyTimeline } from "./core-legacy.js"
import {
  ZERO,
  add,
  frameDuration,
  rational,
  subtract,
  secondsToFrameAligned,
  toSeconds,
} from "./time.js"
import type { NLETrack, NLEClip, NLEAsset, NLEFormat } from "./types.js"

const EDITOR_FORMAT_MAP: Record<NLEEditor, NLEExportFormat> = {
  fcpx: "fcpxml",
  premiere: "xmeml",
  resolve: "xmeml",
  otio: "otio",
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)

  while (b !== 0) {
    ;[a, b] = [b, a % b]
  }

  return a
}

function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return Math.abs((a / gcd(a, b)) * b)
}

function sameFrameRate(a: { num: number; den: number }, b: { num: number; den: number }): boolean {
  return a.num === b.num && a.den === b.den
}

function validateTrimValue(label: "startAt" | "duration", value: number | undefined): void {
  if (value === undefined) return

  if (!Number.isFinite(value)) {
    throw new Error(`Clip ${label} must be a finite number`)
  }

  if (value < 0) {
    throw new Error(`Clip ${label} cannot be negative`)
  }
}

function chooseSharedDuration(
  seconds: number,
  remaining: { num: number; den: number },
  timelineFrameRate: { num: number; den: number },
  sourceFrameRate: { num: number; den: number },
  mode: "nearest" | "floor",
): { num: number; den: number } | null {
  if (seconds <= 0 || sameFrameRate(timelineFrameRate, sourceFrameRate)) {
    return null
  }

  const timelineFrameDuration = frameDuration(timelineFrameRate)
  const sourceFrameDuration = frameDuration(sourceFrameRate)
  const numerator = lcm(
    timelineFrameDuration.num * sourceFrameDuration.den,
    sourceFrameDuration.num * timelineFrameDuration.den,
  )
  const denominator = timelineFrameDuration.den * sourceFrameDuration.den
  const step = rational(numerator, denominator)
  const stepSeconds = toSeconds(step)
  const targetUnits = seconds / stepSeconds
  const unitCount =
    mode === "floor" ? Math.floor(targetUnits + 1e-9) : Math.round(targetUnits)

  if (unitCount <= 0) {
    return null
  }

  const shared = rational(step.num * unitCount, step.den)
  return toSeconds(shared) <= toSeconds(remaining) + 1e-9 ? shared : null
}

/**
 * Export a timeline to the specified NLE format.
 *
 * @param timeline - The timeline to export
 * @param editor - Target editor ("fcpx", "premiere", "resolve", or "otio")
 * @param options - Additional export options
 * @returns XML or JSON string ready to be written to a file
 *
 * @example
 * ```ts
 * const xml = exportTimeline(timeline, "fcpx");
 * fs.writeFileSync("output.fcpxml", xml);
 *
 * const otio = exportTimeline(timeline, "otio");
 * fs.writeFileSync("output.otio", otio);
 * ```
 */
export function exportTimeline(
  timeline: Timeline | NLETimeline,
  editor: NLEEditor,
  options?: Omit<ExportOptions, "format">,
): string {
  const format = EDITOR_FORMAT_MAP[editor]
  const fullOptions: ExportOptions = { ...options, format }
  const legacyTimeline = isLegacyTimeline(timeline) ? timeline : coreToLegacyTimeline(timeline)

  switch (format) {
    case "fcpxml":
      return writeFCPXML(legacyTimeline, fullOptions)
    case "xmeml":
      return writeXMEML(legacyTimeline, fullOptions)
    case "otio":
      return writeOTIO(timeline)
    default:
      throw new Error(`Unsupported format: ${format}`)
  }
}

/**
 * Import a timeline from an XML or OTIO JSON string.
 * Auto-detects FCPXML, xmeml, or OTIO based on content.
 *
 * @param content - The file content to parse (XML or JSON)
 * @returns Parsed timeline and any warnings
 *
 * @example
 * ```ts
 * const xml = fs.readFileSync("project.fcpxml", "utf-8");
 * const { timeline, warnings } = importTimeline(xml);
 *
 * const otio = fs.readFileSync("project.otio", "utf-8");
 * const { timeline: tl2 } = importTimeline(otio);
 * ```
 */
export function importTimeline(content: string): ImportResult {
  const trimmed = content.trim()

  if (trimmed.includes("<fcpxml") || trimmed.includes("<!DOCTYPE fcpxml")) {
    return readFCPXML(content)
  }

  if (trimmed.includes("<xmeml") || trimmed.includes("<!DOCTYPE xmeml")) {
    return readXMEML(content)
  }

  if (trimmed.startsWith("{") && trimmed.includes("OTIO_SCHEMA")) {
    return readOTIO(content)
  }

  throw new Error(
    "Unrecognized format. Expected FCPXML (<fcpxml>), xmeml (<xmeml>), or OTIO (JSON with OTIO_SCHEMA).",
  )
}

/**
 * Build a timeline from a simple list of clip inputs.
 * Probes each file for metadata and sequences clips in order.
 *
 * @param name - Timeline name
 * @param clips - Array of clip inputs with file paths and optional trim points
 * @returns A fully populated NLETimeline
 *
 * @example
 * ```ts
 * const timeline = await buildTimeline("My Edit", [
 *   { path: "/videos/clip1.mp4", duration: 5 },
 *   { path: "/videos/clip2.mp4", startAt: 10, duration: 3 },
 * ]);
 * const xml = exportTimeline(timeline, "premiere");
 * ```
 */
export async function buildTimeline(
  name: string,
  clips: ClipInput[],
): Promise<NLETimeline> {
  if (clips.length === 0) throw new Error("No clips provided")

  const assetCache = new Map<string, NLEAsset>()
  const probedClips: { input: ClipInput; asset: NLEAsset }[] = []

  for (const input of clips) {
    let asset = assetCache.get(input.path)
    if (!asset) {
      asset = await probeAsset(input.path)
      assetCache.set(input.path, asset)
    }
    probedClips.push({ input, asset })
  }

  const firstVideoAsset = probedClips.find((p) => p.asset.hasVideo)?.asset
  const format: NLEFormat = firstVideoAsset?.videoFormat ?? {
    width: 1920,
    height: 1080,
    frameRate: { num: 24, den: 1 },
    audioRate: 48000,
  }

  const trackBuckets = new Map<string, { type: "video" | "audio"; clips: NLEClip[] }>()

  for (const { input, asset } of probedClips) {
    validateTrimValue("startAt", input.startAt)
    validateTrimValue("duration", input.duration)

    const trackType = input.type ?? (asset.hasVideo ? "video" : "audio")
    const trackIdx = input.track ?? 0
    const key = `${trackType}-${trackIdx}`

    if (!trackBuckets.has(key)) {
      trackBuckets.set(key, { type: trackType, clips: [] })
    }
    const bucket = trackBuckets.get(key)!

    const sourceFrameRate = asset.videoFormat?.frameRate ?? format.frameRate
    const hasStartAt = input.startAt !== undefined
    const hasDuration = input.duration !== undefined
    const startAt = input.startAt ?? 0
    const clipDurationSeconds = input.duration ?? 0
    const sourceIn = hasStartAt
      ? secondsToFrameAligned(startAt, sourceFrameRate)
      : ZERO

    if (hasStartAt && toSeconds(sourceIn) >= toSeconds(asset.duration)) {
      throw new Error(
        `Clip "${asset.name}": startAt (${input.startAt}s) is at or beyond media duration (${toSeconds(asset.duration).toFixed(3)}s)`,
      )
    }

    const remaining = subtract(asset.duration, sourceIn)
    let duration
    let sourceDuration

    if (hasDuration) {
      const requestedDuration = Math.min(clipDurationSeconds, toSeconds(remaining))
      if (!sameFrameRate(sourceFrameRate, format.frameRate)) {
        const sharedDuration = chooseSharedDuration(
          requestedDuration,
          remaining,
          format.frameRate,
          sourceFrameRate,
          "nearest",
        )
        const maxAllowedDrift =
          Math.min(
            toSeconds(frameDuration(format.frameRate)),
            toSeconds(frameDuration(sourceFrameRate)),
          ) / 2

        if (
          !sharedDuration ||
          Math.abs(toSeconds(sharedDuration) - requestedDuration) > maxAllowedDrift
        ) {
          throw new Error(
            `Clip "${asset.name}": duration (${input.duration}s) cannot be represented consistently between timeline and source frame rates`,
          )
        }

        duration = sharedDuration
        sourceDuration = sharedDuration
      } else {
        sourceDuration = secondsToFrameAligned(requestedDuration, sourceFrameRate)
        duration = sourceDuration
      }
    } else if (hasStartAt) {
      sourceDuration = remaining
      duration = sameFrameRate(sourceFrameRate, format.frameRate)
        ? sourceDuration
        : secondsToFrameAligned(toSeconds(sourceDuration), format.frameRate)
    } else {
      sourceDuration = asset.duration
      duration = sameFrameRate(sourceFrameRate, format.frameRate)
        ? sourceDuration
        : secondsToFrameAligned(toSeconds(sourceDuration), format.frameRate)
    }

    if (toSeconds(duration) > toSeconds(remaining) + 0.001) {
      duration = remaining
    }
    if (toSeconds(sourceDuration) > toSeconds(remaining) + 0.001) {
      sourceDuration = remaining
    }

    const lastClip = bucket.clips[bucket.clips.length - 1]
    const currentOffset = lastClip ? add(lastClip.offset, lastClip.duration) : ZERO

    bucket.clips.push({
      assetId: asset.id,
      name: asset.name.replace(/\.[^.]+$/, ""),
      offset: currentOffset,
      duration,
      sourceIn,
      sourceDuration,
      audioRole: trackType === "audio" ? "dialogue" : "dialogue",
    })
  }

  const sortedKeys = [...trackBuckets.keys()].sort()
  const tracks: NLETrack[] = sortedKeys.map((key) => {
    const bucket = trackBuckets.get(key)!
    return { type: bucket.type, clips: bucket.clips }
  })

  return {
    name,
    format,
    tracks,
    assets: Array.from(assetCache.values()),
  }
}
