import { createHash } from "node:crypto"
import type {
  Clip,
  ExternalReference,
  MediaReference,
  NLEAsset,
  NLEClip,
  NLETimeline,
  Timeline,
} from "./types.js"
import { ZERO, add, subtract, toSeconds } from "./time.js"

export function isLegacyTimeline(timeline: Timeline | NLETimeline): timeline is NLETimeline {
  return "assets" in timeline
}

function hashId(input: string): string {
  return "r" + createHash("md5").update(input).digest("hex").slice(0, 12)
}

function fileUrlToPath(url: string): string {
  if (url.startsWith("file://")) return decodeURIComponent(url.slice(7))
  return url
}

function inferLegacyAssetFromReference(
  reference: ExternalReference,
  timeline: Timeline,
): NLEAsset {
  const mediaKind = reference.mediaKind ?? "unknown"
  const streamInfo = reference.streamInfo
  const hasVideo = streamInfo?.hasVideo ?? (mediaKind === "video" || mediaKind === "image")
  const hasAudio = streamInfo?.hasAudio ?? mediaKind === "audio"

  return {
    id: hashId(reference.targetUrl),
    name: reference.name ?? reference.targetUrl.split("/").pop() ?? "media",
    path: fileUrlToPath(reference.targetUrl),
    duration: reference.availableRange?.duration ?? ZERO,
    hasVideo,
    hasAudio,
    videoFormat: hasVideo
      ? {
          width: streamInfo?.width ?? timeline.format.width,
          height: streamInfo?.height ?? timeline.format.height,
          frameRate: streamInfo?.frameRate ?? timeline.format.frameRate,
          audioRate: streamInfo?.audioRate ?? timeline.format.audioRate,
          colorSpace: streamInfo?.colorSpace ?? timeline.format.colorSpace,
        }
      : undefined,
    audioChannels: streamInfo?.audioChannels,
    audioRate: streamInfo?.audioRate ?? timeline.format.audioRate,
    timecodeStart: reference.availableRange?.startTime ?? ZERO,
  }
}

function mediaReferenceFromAsset(asset: NLEAsset, timeline: NLETimeline): ExternalReference {
  const mediaKind = asset.hasVideo ? "video" : asset.hasAudio ? "audio" : "unknown"

  return {
    type: "external",
    name: asset.name,
    targetUrl: asset.path,
    mediaKind,
    availableRange: {
      startTime: asset.timecodeStart ?? ZERO,
      duration: asset.duration,
    },
    streamInfo: {
      hasVideo: asset.hasVideo,
      hasAudio: asset.hasAudio,
      width: asset.videoFormat?.width,
      height: asset.videoFormat?.height,
      frameRate: asset.videoFormat?.frameRate ?? timeline.format.frameRate,
      audioRate: asset.audioRate ?? asset.videoFormat?.audioRate,
      audioChannels: asset.audioChannels,
      colorSpace: asset.videoFormat?.colorSpace,
    },
  }
}

function durationFromClip(clip: Clip): { num: number; den: number } {
  return clip.sourceRange?.duration ??
    (clip.mediaReference.type === "external" ? clip.mediaReference.availableRange?.duration : undefined) ??
    ZERO
}

export function legacyToCoreTimeline(timeline: NLETimeline): Timeline {
  const assetMap = new Map(timeline.assets.map((asset) => [asset.id, asset]))

  return {
    name: timeline.name,
    format: timeline.format,
    tracks: timeline.tracks.map((track, index) => {
      const sortedClips = [...track.clips].sort(
        (a, b) => toSeconds(a.offset) - toSeconds(b.offset),
      )
      const items: Timeline["tracks"][number]["items"] = []
      let currentOffset = ZERO

      for (const clip of sortedClips) {
        const gapDuration = subtract(clip.offset, currentOffset)
        if (toSeconds(gapDuration) > 0.0001) {
          items.push({
            kind: "gap",
            sourceRange: {
              startTime: ZERO,
              duration: gapDuration,
            },
          })
        }

        const asset = assetMap.get(clip.assetId)
        const mediaReference: MediaReference = asset
          ? mediaReferenceFromAsset(asset, timeline)
          : {
              type: "missing",
              name: clip.name,
            }

        items.push({
          kind: "clip",
          name: clip.name,
          mediaReference,
          sourceRange: {
            startTime: clip.sourceIn,
            duration: clip.sourceDuration,
          },
          enabled: clip.enabled,
        })

        currentOffset = add(clip.offset, clip.duration)
      }

      return {
        kind: track.type,
        name: `${track.type === "video" ? "Video" : "Audio"} Track ${index + 1}`,
        items,
      }
    }),
  }
}

export function coreToLegacyTimeline(timeline: Timeline): NLETimeline {
  const assets = new Map<string, NLEAsset>()

  const tracks = timeline.tracks.map((track) => {
    const clips: NLEClip[] = []
    let currentOffset = ZERO

    for (const item of track.items) {
      if (item.kind === "gap") {
        currentOffset = add(currentOffset, item.sourceRange.duration)
        continue
      }

      if (item.kind === "transition") {
        continue
      }

      if (item.mediaReference.type !== "external") {
        throw new Error("Legacy export does not support missing references yet")
      }

      const asset = inferLegacyAssetFromReference(item.mediaReference, timeline)
      assets.set(asset.id, asset)

      const sourceDuration = durationFromClip(item)

      clips.push({
        assetId: asset.id,
        name: item.name,
        offset: currentOffset,
        duration: sourceDuration,
        sourceIn: item.sourceRange?.startTime ?? ZERO,
        sourceDuration,
        enabled: item.enabled,
      })

      currentOffset = add(currentOffset, sourceDuration)
    }

    return {
      type: track.kind,
      clips,
    }
  })

  return {
    name: timeline.name,
    format: timeline.format,
    tracks,
    assets: Array.from(assets.values()),
  }
}
