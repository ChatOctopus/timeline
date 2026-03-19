import type {
  CreateTimelineOptions,
  ExternalReference,
  Rational,
  Timeline,
  TimelineFileInput,
  Track,
} from "./types.js"
import { DEFAULT_FORMAT, resolveFormatDefaults } from "./defaults.js"
import { probeMediaReference } from "./probe.js"
import {
  ZERO,
  add,
  frameDuration,
  rational,
  secondsToFrameAligned,
  subtract,
  toSeconds,
} from "./time.js"

function clone<T>(value: T): T {
  return structuredClone(value)
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

function sameFrameRate(a: Rational, b: Rational): boolean {
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
  remaining: Rational,
  timelineFrameRate: Rational,
  sourceFrameRate: Rational,
  mode: "nearest" | "floor",
): Rational | null {
  if (seconds <= 0 || sameFrameRate(timelineFrameRate, sourceFrameRate)) {
    return null
  }

  const timelineFrameStep = frameDuration(timelineFrameRate)
  const sourceFrameStep = frameDuration(sourceFrameRate)
  const numerator = lcm(
    timelineFrameStep.num * sourceFrameStep.den,
    sourceFrameStep.num * timelineFrameStep.den,
  )
  const denominator = timelineFrameStep.den * sourceFrameStep.den
  const sharedStep = rational(numerator, denominator)
  const sharedStepSeconds = toSeconds(sharedStep)
  const targetUnits = seconds / sharedStepSeconds
  const unitCount =
    mode === "floor" ? Math.floor(targetUnits + 1e-9) : Math.round(targetUnits)

  if (unitCount <= 0) {
    return null
  }

  const sharedDuration = rational(sharedStep.num * unitCount, sharedStep.den)
  return toSeconds(sharedDuration) <= toSeconds(remaining) + 1e-9 ? sharedDuration : null
}

function inferTimelineFormat(references: ExternalReference[]): Timeline["format"] {
  const visualReference = references.find(
    (reference) => reference.mediaKind === "video" || reference.mediaKind === "image",
  )
  const firstFrameRate = references.find((reference) => reference.streamInfo?.frameRate)
  const firstAudioRate = references.find((reference) => reference.streamInfo?.audioRate)

  return resolveFormatDefaults({
    width: visualReference?.streamInfo?.width ?? DEFAULT_FORMAT.width,
    height: visualReference?.streamInfo?.height ?? DEFAULT_FORMAT.height,
    frameRate: firstFrameRate?.streamInfo?.frameRate ?? DEFAULT_FORMAT.frameRate,
    audioRate: firstAudioRate?.streamInfo?.audioRate ?? DEFAULT_FORMAT.audioRate,
    colorSpace: visualReference?.streamInfo?.colorSpace,
  })
}

function inferTrackKind(reference: ExternalReference, input: TimelineFileInput): "video" | "audio" {
  if (input.kind) return input.kind
  return reference.mediaKind === "audio" ? "audio" : "video"
}

function clipName(reference: ExternalReference, input: TimelineFileInput): string {
  const base = reference.name ?? input.path.split("/").pop() ?? input.path
  return base.replace(/\.[^.]+$/, "")
}

export function createTimeline(options: CreateTimelineOptions): Timeline {
  if (options.name.trim() === "") {
    throw new Error("Timeline name is required")
  }

  return {
    name: options.name,
    format: resolveFormatDefaults(options.format ? clone(options.format) : undefined),
    tracks: clone(options.tracks ?? []),
    metadata: options.metadata ? clone(options.metadata) : undefined,
    markers: options.markers ? clone(options.markers) : undefined,
    globalStartTime: options.globalStartTime,
  }
}

/**
 * Probe files and build a simple linear Timeline with inline media references.
 */
export async function buildTimelineFromFiles(
  name: string,
  files: TimelineFileInput[],
): Promise<Timeline> {
  if (files.length === 0) {
    throw new Error("No files provided")
  }

  const referenceCache = new Map<string, ExternalReference>()
  const probedFiles: { input: TimelineFileInput; reference: ExternalReference }[] = []

  for (const input of files) {
    let reference = referenceCache.get(input.path)
    if (!reference) {
      reference = await probeMediaReference(input.path)
      referenceCache.set(input.path, reference)
    }

    probedFiles.push({ input, reference })
  }

  const format = inferTimelineFormat(probedFiles.map((entry) => entry.reference))
  const trackBuckets = new Map<string, { kind: "video" | "audio"; index: number; items: Track["items"] }>()

  for (const { input, reference: baseReference } of probedFiles) {
    validateTrimValue("startAt", input.startAt)
    validateTrimValue("duration", input.duration)

    const reference = clone(baseReference)
    const trackKind = inferTrackKind(reference, input)
    const trackIndex = input.track ?? 0
    const bucketKey = `${trackKind}:${trackIndex}`

    if (!trackBuckets.has(bucketKey)) {
      trackBuckets.set(bucketKey, { kind: trackKind, index: trackIndex, items: [] })
    }

    const bucket = trackBuckets.get(bucketKey)!
    const sourceFrameRate = reference.streamInfo?.frameRate ?? format.frameRate
    const hasStartAt = input.startAt !== undefined
    const hasDuration = input.duration !== undefined

    let sourceStart = ZERO
    let duration = ZERO

    if (reference.mediaKind === "image") {
      if (hasStartAt) {
        throw new Error(`Clip "${reference.name ?? input.path}": startAt is not supported for still images`)
      }

      if (!hasDuration) {
        throw new Error(`Clip "${reference.name ?? input.path}": still images require an explicit duration`)
      }

      duration = secondsToFrameAligned(input.duration ?? 0, format.frameRate)
      reference.availableRange = {
        startTime: ZERO,
        duration,
      }
    } else {
      const availableRange = reference.availableRange ?? {
        startTime: ZERO,
        duration: ZERO,
      }

      sourceStart = hasStartAt
        ? secondsToFrameAligned(input.startAt ?? 0, sourceFrameRate)
        : ZERO

      if (hasStartAt && toSeconds(sourceStart) >= toSeconds(availableRange.duration)) {
        throw new Error(
          `Clip "${reference.name ?? input.path}": startAt (${input.startAt}s) is at or beyond media duration (${toSeconds(availableRange.duration).toFixed(3)}s)`,
        )
      }

      const remaining = subtract(availableRange.duration, sourceStart)

      if (hasDuration) {
        const requestedDuration = Math.min(input.duration ?? 0, toSeconds(remaining))

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
              `Clip "${reference.name ?? input.path}": duration (${input.duration}s) cannot be represented consistently between timeline and source frame rates`,
            )
          }

          duration = sharedDuration
        } else {
          duration = secondsToFrameAligned(requestedDuration, sourceFrameRate)
        }
      } else if (hasStartAt) {
        duration = sameFrameRate(sourceFrameRate, format.frameRate)
          ? remaining
          : chooseSharedDuration(
              toSeconds(remaining),
              remaining,
              format.frameRate,
              sourceFrameRate,
              "floor",
            ) ?? secondsToFrameAligned(toSeconds(remaining), format.frameRate)
      } else {
        duration = sameFrameRate(sourceFrameRate, format.frameRate)
          ? availableRange.duration
          : chooseSharedDuration(
              toSeconds(availableRange.duration),
              availableRange.duration,
              format.frameRate,
              sourceFrameRate,
              "floor",
            ) ?? secondsToFrameAligned(toSeconds(availableRange.duration), format.frameRate)
      }
    }

    bucket.items.push({
      kind: "clip",
      name: clipName(reference, input),
      mediaReference: reference,
      sourceRange: {
        startTime: sourceStart,
        duration,
      },
    })
  }

  const tracks = [...trackBuckets.values()]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "video" ? -1 : 1
      return a.index - b.index
    })
    .map<Track>((bucket, index) => ({
      kind: bucket.kind,
      name: `${bucket.kind === "video" ? "Video" : "Audio"} Track ${index + 1}`,
      items: bucket.items,
    }))

  return createTimeline({
    name,
    format,
    tracks,
  })
}
