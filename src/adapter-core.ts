import { createHash } from "node:crypto"
import type {
  Clip,
  ExportOptions,
  ExternalReference,
  MediaReference,
  Rational,
  Timeline,
  Track,
} from "./types.js"
import { ZERO, add, subtract, toSeconds } from "./time.js"
import { toFileUrl } from "./file-url.js"

export interface TrackClipPlacement {
  clip: Clip
  offset: Rational
}

export interface AdapterResource {
  id: string
  reference: ExternalReference
  inferredDuration: Rational
}

export function makeWarningEmitter(options?: ExportOptions): (warning: string) => void {
  const seen = new Set<string>()

  return (warning: string) => {
    if (seen.has(warning)) return
    seen.add(warning)
    options?.onWarning?.(warning)
  }
}

export function clipDuration(clip: Clip): Rational {
  if (clip.sourceRange) return clip.sourceRange.duration
  if (clip.mediaReference.type === "external" && clip.mediaReference.availableRange) {
    return clip.mediaReference.availableRange.duration
  }

  return ZERO
}

function hasMetadata(value: { metadata?: Record<string, unknown> } | undefined): boolean {
  return !!value?.metadata && Object.keys(value.metadata).length > 0
}

function hasMarkers(value: { markers?: unknown[] } | undefined): boolean {
  return Array.isArray(value?.markers) && value.markers.length > 0
}

function isMissingReference(reference: MediaReference): boolean {
  return reference.type === "missing"
}

export function warnOnUnsupportedExportFeatures(
  timeline: Timeline,
  emitWarning: (warning: string) => void,
): void {
  if (hasMetadata(timeline)) {
    emitWarning("Timeline metadata is not supported in this export format and was dropped")
  }
  if (hasMarkers(timeline)) {
    emitWarning("Timeline markers are not supported in this export format and were dropped")
  }

  for (const track of timeline.tracks) {
    if (hasMetadata(track)) {
      emitWarning("Track metadata is not supported in this export format and was dropped")
    }
    if (hasMarkers(track)) {
      emitWarning("Track markers are not supported in this export format and were dropped")
    }
    if (track.enabled === false) {
      emitWarning("Track enabled state is not supported in this export format and was dropped")
    }

    for (const item of track.items) {
      if (item.kind === "transition") {
        emitWarning("Transitions are not supported in this export format and were dropped")
        continue
      }

      if (hasMetadata(item)) {
        emitWarning("Clip and gap metadata is not supported in this export format and was dropped")
      }

      if (item.kind === "gap") {
        if (item.enabled === false) {
          emitWarning("Gap enabled state is not supported in this export format and was dropped")
        }
        continue
      }

      if (hasMarkers(item)) {
        emitWarning("Clip markers are not supported in this export format and were dropped")
      }
      if (item.mediaReference.type === "external" && hasMetadata(item.mediaReference)) {
        emitWarning("Media reference metadata is not supported in this export format and was dropped")
      }
      if (isMissingReference(item.mediaReference)) {
        emitWarning("Missing media references are not supported in this export format and were dropped")
      }
    }
  }
}

export function trackClipPlacements(
  track: Track,
  emitWarning?: (warning: string) => void,
): TrackClipPlacement[] {
  const placements: TrackClipPlacement[] = []
  let currentOffset = ZERO

  for (const item of track.items) {
    if (item.kind === "gap") {
      currentOffset = add(currentOffset, item.sourceRange.duration)
      continue
    }

    if (item.kind === "transition") {
      emitWarning?.("Transitions are not supported in this export format and were dropped")
      continue
    }

    placements.push({
      clip: item,
      offset: currentOffset,
    })
    currentOffset = add(currentOffset, clipDuration(item))
  }

  return placements
}

function compareRationals(a: Rational, b: Rational): number {
  return toSeconds(a) - toSeconds(b)
}

function maxRational(a: Rational, b: Rational): Rational {
  return compareRationals(a, b) >= 0 ? a : b
}

function resourceId(targetUrl: string): string {
  return "r" + createHash("md5").update(targetUrl).digest("hex").slice(0, 12)
}

export function normalizeTargetUrl(targetUrl: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(targetUrl)) {
    return targetUrl
  }

  return toFileUrl(targetUrl)
}

export function collectAdapterResources(timeline: Timeline): AdapterResource[] {
  const resources = new Map<string, AdapterResource>()

  for (const track of timeline.tracks) {
    for (const item of track.items) {
      if (item.kind !== "clip" || item.mediaReference.type !== "external") {
        continue
      }

      const targetUrl = normalizeTargetUrl(item.mediaReference.targetUrl)
      const inferredDuration = clipDuration(item)
      const existing = resources.get(targetUrl)

      if (!existing) {
        resources.set(targetUrl, {
          id: resourceId(targetUrl),
          reference: {
            ...item.mediaReference,
            targetUrl,
          },
          inferredDuration,
        })
        continue
      }

      existing.inferredDuration = maxRational(existing.inferredDuration, inferredDuration)
      if (!existing.reference.availableRange && item.mediaReference.availableRange) {
        existing.reference.availableRange = item.mediaReference.availableRange
      }
      if (!existing.reference.streamInfo && item.mediaReference.streamInfo) {
        existing.reference.streamInfo = item.mediaReference.streamInfo
      }
      if (!existing.reference.name && item.mediaReference.name) {
        existing.reference.name = item.mediaReference.name
      }
    }
  }

  return [...resources.values()]
}

export function trackFromPlacements(
  kind: "video" | "audio",
  placements: TrackClipPlacement[],
  name?: string,
): Track | null {
  const sortedPlacements = [...placements].sort((a, b) => compareRationals(a.offset, b.offset))
  const items: Track["items"] = []
  let currentOffset = ZERO

  for (const placement of sortedPlacements) {
    if (compareRationals(placement.offset, currentOffset) > 0) {
      items.push({
        kind: "gap",
        sourceRange: {
          startTime: ZERO,
          duration: subtract(placement.offset, currentOffset),
        },
      })
    }

    items.push(placement.clip)
    currentOffset = add(placement.offset, clipDuration(placement.clip))
  }

  if (items.length === 0) return null

  return {
    kind,
    name,
    items,
  }
}
