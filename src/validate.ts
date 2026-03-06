import type { NLETimeline, NLEClip, NLEAsset, Rational } from "./types.js"
import { toSeconds, toFrames, frameDuration, isZero, add } from "./time.js"

export interface ValidationError {
  type: "error" | "warning"
  message: string
  clip?: string
}

/**
 * Validate a timeline for correctness before export.
 * Returns an array of errors/warnings. Empty array means valid.
 */
export function validateTimeline(timeline: NLETimeline): ValidationError[] {
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

  const assetMap = new Map(timeline.assets.map((a) => [a.id, a]))

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      validateClip(clip, assetMap, timeline.format.frameRate, errors)
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

  return errors
}

function validateClip(
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

  const fd = frameDuration(frameRate)
  const durationFrames = toFrames(clip.duration, fd)
  const reconstructed = toSeconds({
    num: durationFrames * fd.num,
    den: fd.den,
  })
  const original = toSeconds(clip.duration)
  if (Math.abs(reconstructed - original) > 0.001) {
    errors.push({
      type: "warning",
      message: `Clip "${clip.name}" duration may not be frame-aligned`,
      clip: clip.name,
    })
  }
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
export function computeTimelineDuration(timeline: NLETimeline): Rational {
  let maxEnd: Rational = { num: 0, den: 1 }
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
