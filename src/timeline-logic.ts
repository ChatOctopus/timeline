import type { Clip, Rational, Timeline, Track, TrackItem, Transition } from "./types.js"
import { ZERO, add, subtract, toSeconds } from "./time.js"

export interface TrackClipPlacement {
  clip: Clip
  offset: Rational
}

export interface TrackTimingOptions {
  transitionPolicy?: "overlap" | "drop"
  onUnsupportedTransition?: () => void
}

export function itemDuration(item: TrackItem): Rational {
  switch (item.kind) {
    case "clip":
      if (item.sourceRange) return item.sourceRange.duration
      if (item.mediaReference.type === "external" && item.mediaReference.availableRange) {
        return item.mediaReference.availableRange.duration
      }
      return ZERO
    case "gap":
      return item.sourceRange.duration
    case "transition":
      return ZERO
  }
}

export function transitionDuration(transition: Transition): Rational {
  return add(transition.inOffset, transition.outOffset)
}

export function trackClipPlacements(
  track: Track,
  options?: TrackTimingOptions,
): TrackClipPlacement[] {
  const transitionPolicy = options?.transitionPolicy ?? "overlap"
  const placements: TrackClipPlacement[] = []
  let currentOffset = ZERO

  for (const item of track.items) {
    if (item.kind === "gap") {
      currentOffset = add(currentOffset, item.sourceRange.duration)
      continue
    }

    if (item.kind === "transition") {
      if (transitionPolicy === "drop") {
        options?.onUnsupportedTransition?.()
      } else {
        currentOffset = subtract(currentOffset, transitionDuration(item))
      }
      continue
    }

    placements.push({
      clip: item,
      offset: currentOffset,
    })
    currentOffset = add(currentOffset, itemDuration(item))
  }

  return placements
}

export function trackDuration(
  track: Track,
  options?: TrackTimingOptions,
): Rational {
  const transitionPolicy = options?.transitionPolicy ?? "overlap"
  let current = ZERO

  for (const item of track.items) {
    if (item.kind === "transition") {
      if (transitionPolicy === "drop") {
        options?.onUnsupportedTransition?.()
      } else {
        current = subtract(current, transitionDuration(item))
      }
      continue
    }

    current = add(current, itemDuration(item))
  }

  return current
}

export function timelineDuration(
  timeline: Timeline,
  options?: TrackTimingOptions,
): Rational {
  let maxEnd = ZERO

  for (const track of timeline.tracks) {
    const end = trackDuration(track, options)
    if (toSeconds(end) > toSeconds(maxEnd)) {
      maxEnd = end
    }
  }

  return maxEnd
}
