import type {
  Timeline,
  TrackItem,
  Clip,
  Gap,
  Transition,
  MediaReference,
  NLETimeline,
  NLEClip,
  NLEAsset,
  Rational,
} from "./types.js"
import { ZERO, toSeconds, toFrames, frameDuration, isZero, add } from "./time.js"

export interface ValidationError {
  type: "error" | "warning"
  message: string
  clip?: string
}

function isCoreTimeline(timeline: Timeline | NLETimeline): timeline is Timeline {
  if (!("tracks" in timeline) || !Array.isArray(timeline.tracks)) return false
  if (!("assets" in timeline)) return true
  return timeline.tracks.some((track) => "items" in track)
}

function compareRationals(a: Rational, b: Rational): number {
  return toSeconds(a) - toSeconds(b)
}

function warnIfNotFrameAligned(
  duration: Rational,
  frameRate: Rational,
  errors: ValidationError[],
  message: string,
  clip?: string,
): void {
  const fd = frameDuration(frameRate)
  const durationFrames = toFrames(duration, fd)
  const reconstructed = toSeconds({
    num: durationFrames * fd.num,
    den: fd.den,
  })
  const original = toSeconds(duration)

  if (Math.abs(reconstructed - original) > 0.001) {
    errors.push({ type: "warning", message, clip })
  }
}

function durationFromMediaReference(mediaReference: MediaReference): Rational {
  if (mediaReference.type === "external" && mediaReference.availableRange) {
    return mediaReference.availableRange.duration
  }
  return ZERO
}

function durationFromItem(item: TrackItem): Rational {
  switch (item.kind) {
    case "clip":
      return item.sourceRange?.duration ?? durationFromMediaReference(item.mediaReference)
    case "gap":
      return item.sourceRange.duration
    case "transition":
      return ZERO
  }
}

function validateCoreClip(
  clip: Clip,
  frameRate: Rational,
  errors: ValidationError[],
): void {
  const reference = clip.mediaReference

  if (reference.type === "external" && reference.targetUrl.trim() === "") {
    errors.push({
      type: "error",
      message: `Clip "${clip.name}" has an external reference without a targetUrl`,
      clip: clip.name,
    })
  }

  if (clip.sourceRange) {
    if (compareRationals(clip.sourceRange.startTime, ZERO) < 0) {
      errors.push({
        type: "error",
        message: `Clip "${clip.name}" has negative sourceRange.startTime`,
        clip: clip.name,
      })
    }

    if (compareRationals(clip.sourceRange.duration, ZERO) < 0) {
      errors.push({
        type: "error",
        message: `Clip "${clip.name}" has negative sourceRange.duration`,
        clip: clip.name,
      })
    }

    if (isZero(clip.sourceRange.duration)) {
      errors.push({
        type: "warning",
        message: `Clip "${clip.name}" has zero duration`,
        clip: clip.name,
      })
    }

    warnIfNotFrameAligned(
      clip.sourceRange.duration,
      frameRate,
      errors,
      `Clip "${clip.name}" duration may not be frame-aligned`,
      clip.name,
    )
  }

  if (reference.type === "external" && reference.availableRange && clip.sourceRange) {
    const sourceEnd = toSeconds(add(clip.sourceRange.startTime, clip.sourceRange.duration))
    const assetDur = toSeconds(reference.availableRange.duration)

    if (sourceEnd > assetDur + 0.001) {
      errors.push({
        type: "error",
        message: `Clip "${clip.name}" source range exceeds media reference duration (${sourceEnd.toFixed(3)}s > ${assetDur.toFixed(3)}s)`,
        clip: clip.name,
      })
    }
  }
}

function validateCoreGap(gap: Gap, frameRate: Rational, errors: ValidationError[]): void {
  if (compareRationals(gap.sourceRange.startTime, ZERO) < 0) {
    errors.push({
      type: "error",
      message: "Gap has negative sourceRange.startTime",
    })
  }

  if (compareRationals(gap.sourceRange.duration, ZERO) < 0) {
    errors.push({
      type: "error",
      message: "Gap has negative sourceRange.duration",
    })
  }

  if (isZero(gap.sourceRange.duration)) {
    errors.push({
      type: "warning",
      message: "Gap has zero duration",
    })
  }

  warnIfNotFrameAligned(
    gap.sourceRange.duration,
    frameRate,
    errors,
    "Gap duration may not be frame-aligned",
  )
}

function validateCoreTransition(
  transition: Transition,
  errors: ValidationError[],
): void {
  if (compareRationals(transition.inOffset, ZERO) < 0) {
    errors.push({
      type: "error",
      message: `Transition "${transition.name ?? "unnamed"}" has negative inOffset`,
    })
  }

  if (compareRationals(transition.outOffset, ZERO) < 0) {
    errors.push({
      type: "error",
      message: `Transition "${transition.name ?? "unnamed"}" has negative outOffset`,
    })
  }

  if (isZero(transition.inOffset) && isZero(transition.outOffset)) {
    errors.push({
      type: "warning",
      message: `Transition "${transition.name ?? "unnamed"}" has no overlap`,
    })
  }
}

function validateCoreTimeline(timeline: Timeline, errors: ValidationError[]): void {
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      switch (item.kind) {
        case "clip":
          validateCoreClip(item, timeline.format.frameRate, errors)
          break
        case "gap":
          validateCoreGap(item, timeline.format.frameRate, errors)
          break
        case "transition":
          validateCoreTransition(item, errors)
          break
      }
    }
  }
}

function validateLegacyClip(
  clip: NLEClip,
  assetMap: Map<string, NLEAsset>,
  frameRate: Rational,
  errors: ValidationError[],
): void {
  if (!assetMap.has(clip.assetId)) {
    errors.push({
      type: "error",
      message: `Clip "${clip.name}" references unknown asset "${clip.assetId}"`,
      clip: clip.name,
    })
  }

  if (isZero(clip.duration)) {
    errors.push({
      type: "warning",
      message: `Clip "${clip.name}" has zero duration`,
      clip: clip.name,
    })
  }

  if (toSeconds(clip.duration) < 0) {
    errors.push({
      type: "error",
      message: `Clip "${clip.name}" has negative duration`,
      clip: clip.name,
    })
  }

  if (toSeconds(clip.sourceIn) < 0) {
    errors.push({
      type: "error",
      message: `Clip "${clip.name}" has negative sourceIn`,
      clip: clip.name,
    })
  }

  if (toSeconds(clip.sourceDuration) < 0) {
    errors.push({
      type: "error",
      message: `Clip "${clip.name}" has negative sourceDuration`,
      clip: clip.name,
    })
  }

  const asset = assetMap.get(clip.assetId)
  if (asset && !isZero(asset.duration)) {
    const sourceEnd = toSeconds(add(clip.sourceIn, clip.sourceDuration))
    const assetDur = toSeconds(asset.duration)
    if (sourceEnd > assetDur + 0.001) {
      errors.push({
        type: "error",
        message: `Clip "${clip.name}" source range exceeds asset duration (${sourceEnd.toFixed(3)}s > ${assetDur.toFixed(3)}s)`,
        clip: clip.name,
      })
    }
  }

  warnIfNotFrameAligned(
    clip.duration,
    frameRate,
    errors,
    `Clip "${clip.name}" duration may not be frame-aligned`,
    clip.name,
  )
}

function validateLegacyTimeline(timeline: NLETimeline, errors: ValidationError[]): void {
  const assetMap = new Map(timeline.assets.map((a) => [a.id, a]))

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      validateLegacyClip(clip, assetMap, timeline.format.frameRate, errors)
    }
  }

  for (const asset of timeline.assets) {
    if (!asset.path) {
      errors.push({
        type: "error",
        message: `Asset "${asset.name}" has no file path`,
      })
    }

    if (isZero(asset.duration) && asset.hasVideo) {
      errors.push({
        type: "warning",
        message: `Video asset "${asset.name}" has zero duration`,
      })
    }
  }
}

/**
 * Validate a timeline for correctness before export.
 * Returns an array of errors/warnings. Empty array means valid.
 */
export function validateTimeline(timeline: Timeline | NLETimeline): ValidationError[] {
  const errors: ValidationError[] = []

  if (!timeline.name) {
    errors.push({ type: "error", message: "Timeline name is required" })
  }

  if (timeline.format.width <= 0 || timeline.format.height <= 0) {
    errors.push({
      type: "error",
      message: `Invalid dimensions: ${timeline.format.width}x${timeline.format.height}`,
    })
  }

  if (
    timeline.format.frameRate.num <= 0 ||
    timeline.format.frameRate.den <= 0
  ) {
    errors.push({
      type: "error",
      message: "Invalid frame rate",
    })
  }

  if (isCoreTimeline(timeline)) {
    validateCoreTimeline(timeline, errors)
  } else {
    validateLegacyTimeline(timeline, errors)
  }

  return errors
}

/**
 * Check if timeline has any hard errors (not just warnings).
 */
export function hasErrors(results: ValidationError[]): boolean {
  return results.some((r) => r.type === "error")
}

/**
 * Compute total timeline duration from all tracks.
 */
export function computeTimelineDuration(timeline: Timeline | NLETimeline): Rational {
  let maxEnd: Rational = ZERO

  if (isCoreTimeline(timeline)) {
    for (const track of timeline.tracks) {
      let current = ZERO

      for (const item of track.items) {
        current = add(current, durationFromItem(item))
      }

      if (toSeconds(current) > toSeconds(maxEnd)) {
        maxEnd = current
      }
    }

    return maxEnd
  }

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const clipEnd = add(clip.offset, clip.duration)
      if (toSeconds(clipEnd) > toSeconds(maxEnd)) {
        maxEnd = clipEnd
      }
    }
  }

  return maxEnd
}
