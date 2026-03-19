import type {
  Timeline,
  ExportOptions,
  ExternalReference,
  Rational,
} from "../types.js"
import {
  toFCPString,
  ZERO,
  add,
  subtract,
  frameDuration,
  isZero,
  toSeconds,
  isDropFrame,
} from "../time.js"
import {
  validateTimeline,
} from "../validate.js"
import {
  clipDuration,
  collectAdapterResources,
  makeWarningEmitter,
  mediaCapabilities,
  normalizeTargetUrl,
  sequenceAudioLayout,
  warnOnUnsupportedExportFeatures,
} from "../adapter-core.js"
import { timelineDuration, trackClipPlacements } from "../timeline-logic.js"

interface XMLNode {
  tag: string
  attrs?: Record<string, string>
  children?: (XMLNode | string)[]
  selfClose?: boolean
}

interface ConnectedPlacement {
  clip: Timeline["tracks"][number]["items"][number] & { kind: "clip" }
  offset: Rational
  lane: number
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function renderNode(node: XMLNode, indent: number): string {
  const pad = "  ".repeat(indent)
  const attrStr = node.attrs
    ? Object.entries(node.attrs)
        .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
        .join("")
    : ""

  if (node.selfClose || !node.children || node.children.length === 0) {
    return `${pad}<${node.tag}${attrStr}/>`
  }

  const hasOnlyText =
    node.children.length === 1 && typeof node.children[0] === "string"
  if (hasOnlyText) {
    return `${pad}<${node.tag}${attrStr}>${escapeXml(node.children[0] as string)}</${node.tag}>`
  }

  const childrenStr = node.children
    .map((child) =>
      typeof child === "string"
        ? `${pad}  ${escapeXml(child)}`
        : renderNode(child, indent + 1),
    )
    .join("\n")

  return `${pad}<${node.tag}${attrStr}>\n${childrenStr}\n${pad}</${node.tag}>`
}

function buildFormatNode(timeline: Timeline, formatId: string): XMLNode {
  const fd = frameDuration(timeline.format.frameRate)
  return {
    tag: "format",
    attrs: {
      id: formatId,
      width: String(timeline.format.width),
      height: String(timeline.format.height),
      frameDuration: toFCPString(fd),
      ...(timeline.format.colorSpace ? { colorSpace: timeline.format.colorSpace } : {}),
    },
  }
}

function buildAssetNode(
  resource: ReturnType<typeof collectAdapterResources>[number],
  formatId: string,
): XMLNode {
  const caps = mediaCapabilities(resource.reference)
  const availableRange = resource.reference.availableRange ?? {
    startTime: ZERO,
    duration: resource.inferredDuration,
  }

  const attrs: Record<string, string> = {
    id: resource.id,
    name: resource.reference.name ?? resource.reference.targetUrl.split("/").pop() ?? resource.id,
    uid: resource.id,
    src: normalizeTargetUrl(resource.reference.targetUrl),
    start: toFCPString(availableRange.startTime),
    duration: toFCPString(availableRange.duration),
    format: formatId,
  }

  if (caps.hasVideo) attrs.hasVideo = "1"
  if (caps.hasAudio) {
    attrs.hasAudio = "1"
    if (caps.audioRate) attrs.audioRate = String(caps.audioRate)
    if (caps.audioChannels) attrs.audioChannels = String(caps.audioChannels)
  }

  return { tag: "asset", attrs }
}

function clipStart(clip: ConnectedPlacement["clip"]): string {
  if (clip.mediaReference.type !== "external") return "0s"

  const availableStart = clip.mediaReference.availableRange?.startTime ?? ZERO
  const sourceStart = clip.sourceRange?.startTime ?? ZERO
  return toFCPString(isZero(availableStart) ? sourceStart : add(availableStart, sourceStart))
}

function buildAssetClipNode(
  clip: ConnectedPlacement["clip"],
  resourceId: string,
  offset: { num: number; den: number },
  lane: number | undefined,
  volumeDb?: number,
): XMLNode {
  const attrs: Record<string, string> = {
    name: clip.name,
    ref: resourceId,
    offset: toFCPString(offset),
    duration: toFCPString(clipDuration(clip)),
    start: clipStart(clip),
  }

  const audioRole = typeof clip.metadata?.audioRole === "string"
    ? clip.metadata.audioRole
    : undefined
  if (audioRole) attrs.audioRole = audioRole
  if (lane !== undefined && lane !== 0) attrs.lane = String(lane)
  if (clip.enabled === false) attrs.enabled = "0"

  const children: XMLNode[] = []
  if (volumeDb !== undefined && volumeDb !== 0) {
    children.push({
      tag: "adjust-volume",
      attrs: { amount: `${volumeDb}dB` },
    })
  }

  return {
    tag: "asset-clip",
    attrs,
    children: children.length > 0 ? children : undefined,
  }
}

function attachConnectedClips(
  node: XMLNode,
  connected: ConnectedPlacement[],
  resourceMap: Map<string, string>,
  volumeDb: number | undefined,
): void {
  if (connected.length === 0) return

  node.children = node.children ?? []
  for (const placement of connected) {
    if (placement.clip.mediaReference.type !== "external") {
      continue
    }

    const resourceId = resourceMap.get(normalizeTargetUrl(placement.clip.mediaReference.targetUrl))
    if (!resourceId) continue

    node.children.push(
      buildAssetClipNode(placement.clip, resourceId, placement.offset, placement.lane, volumeDb),
    )
  }
}

/**
 * Generate FCPXML 1.8 from a Timeline.
 */
export function writeFCPXML(
  timeline: Timeline,
  options?: ExportOptions,
): string {
  const errors = validateTimeline(timeline)
  const hardErrors = errors.filter((error) => error.type === "error")
  if (hardErrors.length > 0) {
    throw new Error(
      `Timeline validation failed:\n${hardErrors.map((error) => `  - ${error.message}`).join("\n")}`,
    )
  }
  const emitWarning = makeWarningEmitter(options)
  warnOnUnsupportedExportFeatures(timeline, emitWarning)

  const formatId = "r1"
  const volumeDb = options?.volumeDb
  const resources = collectAdapterResources(timeline)
  const resourceMap = new Map(resources.map((resource) => [resource.reference.targetUrl, resource.id]))
  const sequenceDuration = timelineDuration(timeline, {
    transitionPolicy: "drop",
    onUnsupportedTransition() {
      emitWarning("Transitions are not supported in this export format and were dropped")
    },
  })

  const primaryTrackIndex = timeline.tracks.findIndex((track) => track.kind === "video")
  const fallbackPrimaryIndex = primaryTrackIndex >= 0 ? primaryTrackIndex : (timeline.tracks[0] ? 0 : -1)
  const primaryTrack = fallbackPrimaryIndex >= 0 ? timeline.tracks[fallbackPrimaryIndex] : undefined

  const connectedPlacements: ConnectedPlacement[] = timeline.tracks
    .flatMap((track, index) => {
      if (index === fallbackPrimaryIndex) return []

      const lane = index < fallbackPrimaryIndex || fallbackPrimaryIndex < 0
        ? index + 1
        : index

      return trackClipPlacements(track, {
        transitionPolicy: "drop",
        onUnsupportedTransition() {
          emitWarning("Transitions are not supported in this export format and were dropped")
        },
      })
        .filter((placement) => placement.clip.mediaReference.type === "external")
        .map((placement) => ({
          clip: placement.clip,
          offset: placement.offset,
          lane,
        }))
    })
    .sort((a, b) => toSeconds(a.offset) - toSeconds(b.offset))

  const remainingConnected = [...connectedPlacements]
  const spineChildren: XMLNode[] = []
  let currentTime = ZERO

  if (primaryTrack) {
    for (const item of primaryTrack.items) {
      if (item.kind === "transition") {
        emitWarning("Transitions are not supported in this export format and were dropped")
        continue
      }

      if (item.kind === "gap") {
        const gapDuration = item.sourceRange.duration
        const gapEnd = add(currentTime, gapDuration)
        const node: XMLNode = {
          tag: "gap",
          attrs: {
            name: "Gap",
            offset: toFCPString(currentTime),
            duration: toFCPString(gapDuration),
            start: "0s",
          },
        }

        const attached = remainingConnected.filter((placement) => {
          const placementStart = toSeconds(placement.offset)
          return placementStart >= toSeconds(currentTime) && placementStart < toSeconds(gapEnd)
        })

        attachConnectedClips(node, attached, resourceMap, volumeDb)
        spineChildren.push(node)
        currentTime = gapEnd
        for (const placement of attached) {
          remainingConnected.splice(remainingConnected.indexOf(placement), 1)
        }
        continue
      }

      const duration = clipDuration(item)
      const clipEnd = add(currentTime, duration)

      if (item.mediaReference.type !== "external") {
        emitWarning("Missing media references are not supported in this export format and were dropped")
        currentTime = clipEnd
        continue
      }

      const resourceId = resourceMap.get(normalizeTargetUrl(item.mediaReference.targetUrl))
      if (!resourceId) {
        currentTime = clipEnd
        continue
      }

      const node = buildAssetClipNode(item, resourceId, currentTime, undefined, volumeDb)
      const attached = remainingConnected.filter((placement) => {
        const placementStart = toSeconds(placement.offset)
        return placementStart >= toSeconds(currentTime) && placementStart < toSeconds(clipEnd)
      })

      attachConnectedClips(node, attached, resourceMap, volumeDb)
      spineChildren.push(node)
      currentTime = clipEnd
      for (const placement of attached) {
        remainingConnected.splice(remainingConnected.indexOf(placement), 1)
      }
    }
  }

  if (remainingConnected.length > 0) {
    const maxEnd = remainingConnected.reduce((max, placement) => {
      const end = add(placement.offset, clipDuration(placement.clip))
      return toSeconds(end) > toSeconds(max) ? end : max
    }, currentTime)

    const node: XMLNode = {
      tag: "gap",
      attrs: {
        name: "Gap",
        offset: toFCPString(currentTime),
        duration: toFCPString(subtract(maxEnd, currentTime)),
        start: "0s",
      },
    }

    attachConnectedClips(node, remainingConnected, resourceMap, volumeDb)
    spineChildren.push(node)
  }

  const audioRateStr =
    timeline.format.audioRate >= 1000
      ? `${Math.round(timeline.format.audioRate / 1000)}k`
      : String(timeline.format.audioRate)
  const now = new Date()
  const modDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`

  const fcpxml: XMLNode = {
    tag: "fcpxml",
    attrs: { version: "1.8" },
    children: [
      {
        tag: "resources",
        children: [
          buildFormatNode(timeline, formatId),
          ...resources.map((resource) => buildAssetNode(resource, formatId)),
        ],
      },
      {
        tag: "library",
        children: [
          {
            tag: "event",
            attrs: { name: timeline.name },
            children: [
              {
                tag: "project",
                attrs: { name: timeline.name, modDate },
                children: [
                  {
                    tag: "sequence",
                    attrs: {
                      duration: toFCPString(sequenceDuration),
                      format: formatId,
                      tcStart: toFCPString(timeline.globalStartTime ?? ZERO),
                      tcFormat: isDropFrame(timeline.format.frameRate) ? "DF" : "NDF",
                      audioLayout: sequenceAudioLayout(timeline.format),
                      audioRate: audioRateStr,
                    },
                    children: [
                      {
                        tag: "spine",
                        children: spineChildren,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }

  const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n\n`
  return xmlHeader + renderNode(fcpxml, 0) + "\n"
}
