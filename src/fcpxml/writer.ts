import type {
  NLETimeline,
  NLEAsset,
  NLEClip,
  NLETrack,
  ExportOptions,
} from "../types.js"
import {
  toFCPString,
  ZERO,
  add,
  subtract,
  frameDuration,
  isZero,
  toSeconds,
} from "../time.js"
import {
  validateTimeline,
  hasErrors,
  computeTimelineDuration,
} from "../validate.js"
import { toFileUrl } from "../file-url.js"

interface XMLNode {
  tag: string
  attrs?: Record<string, string>
  children?: (XMLNode | string)[]
  selfClose?: boolean
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
        .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
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
    .map((c) =>
      typeof c === "string"
        ? `${pad}  ${escapeXml(c)}`
        : renderNode(c, indent + 1),
    )
    .join("\n")

  return `${pad}<${node.tag}${attrStr}>\n${childrenStr}\n${pad}</${node.tag}>`
}

function buildFormatNode(timeline: NLETimeline, formatId: string): XMLNode {
  const fmt = timeline.format
  const fd = frameDuration(fmt.frameRate)
  return {
    tag: "format",
    attrs: {
      id: formatId,
      width: String(fmt.width),
      height: String(fmt.height),
      frameDuration: toFCPString(fd),
      ...(fmt.colorSpace ? { colorSpace: fmt.colorSpace } : {}),
    },
  }
}

function buildAssetNode(asset: NLEAsset, formatId: string): XMLNode {
  const attrs: Record<string, string> = {
    id: asset.id,
    name: asset.name,
    uid: asset.id,
    src: toFileUrl(asset.path),
    start: toFCPString(asset.timecodeStart ?? ZERO),
    duration: toFCPString(asset.duration),
    format: formatId,
  }

  if (asset.hasVideo) {
    attrs.hasVideo = "1"
  }
  if (asset.hasAudio) {
    attrs.hasAudio = "1"
    if (asset.audioRate) attrs.audioRate = String(asset.audioRate)
    if (asset.audioChannels) attrs.audioChannels = String(asset.audioChannels)
  }

  return { tag: "asset", attrs }
}

function buildAssetClipNode(
  clip: NLEClip,
  asset: NLEAsset,
  volumeDb?: number,
): XMLNode {
  const tcStart = asset.timecodeStart ?? ZERO
  const clipStart = isZero(tcStart)
    ? clip.sourceIn
    : add(tcStart, clip.sourceIn)

  const attrs: Record<string, string> = {
    name: clip.name,
    ref: clip.assetId,
    offset: toFCPString(clip.offset),
    duration: toFCPString(clip.duration),
    start: toFCPString(clipStart),
  }

  if (clip.audioRole) attrs.audioRole = clip.audioRole
  if (clip.lane !== undefined && clip.lane !== 0) attrs.lane = String(clip.lane)
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

/**
 * Generate FCPXML 1.8 from an NLETimeline.
 */
export function writeFCPXML(
  timeline: NLETimeline,
  options?: ExportOptions,
): string {
  const errors = validateTimeline(timeline)
  const hardErrors = errors.filter((e) => e.type === "error")
  if (hardErrors.length > 0) {
    throw new Error(
      `Timeline validation failed:\n${hardErrors.map((e) => `  - ${e.message}`).join("\n")}`,
    )
  }

  const formatId = "r1"
  const volumeDb = options?.volumeDb
  const assetMap = new Map(timeline.assets.map((a) => [a.id, a]))

  const sequenceDuration = computeTimelineDuration(timeline)

  const videoTracks = timeline.tracks.filter((t) => t.type === "video")
  const primaryClips = videoTracks[0]?.clips ?? []
  const connectedClips = videoTracks
    .slice(1)
    .flatMap((t, ti) =>
      t.clips.map((c) => ({ ...c, lane: c.lane ?? ti + 1 })),
    )

  const sortedPrimary = [...primaryClips].sort(
    (a, b) => a.offset.num / a.offset.den - b.offset.num / b.offset.den,
  )

  const spineChildren: XMLNode[] = []
  let currentTime = ZERO
  let remainingConnected = [...connectedClips]

  for (const clip of sortedPrimary) {
    const clipOffsetSec = toSeconds(clip.offset)
    const currentSec = toSeconds(currentTime)

    if (clipOffsetSec > currentSec + 0.0001) {
      const gapDuration = subtract(clip.offset, currentTime)
      const gapNode: XMLNode = {
        tag: "gap",
        attrs: {
          name: "Gap",
          offset: toFCPString(currentTime),
          duration: toFCPString(gapDuration),
          start: "0s",
        },
      }

      const gapEnd = clipOffsetSec
      const attached = remainingConnected.filter((cc) => {
        const ccStart = toSeconds(cc.offset)
        return ccStart >= currentSec && ccStart < gapEnd
      })

      if (attached.length > 0) {
        gapNode.children = []
        for (const cc of attached) {
          const ccAsset = assetMap.get(cc.assetId)
          if (!ccAsset) throw new Error(`Asset not found: ${cc.assetId}`)
          const ccNode = buildAssetClipNode(cc, ccAsset, volumeDb)
          if (!ccNode.attrs!.lane) {
            ccNode.attrs!.lane = String(cc.lane ?? 1)
          }
          gapNode.children.push(ccNode)
        }
        remainingConnected = remainingConnected.filter(
          (c) => !attached.includes(c),
        )
      }

      spineChildren.push(gapNode)
      currentTime = clip.offset
    }

    const asset = assetMap.get(clip.assetId)
    if (!asset) throw new Error(`Asset not found: ${clip.assetId}`)
    const node = buildAssetClipNode(clip, asset, volumeDb)

    const clipStart = toSeconds(clip.offset)
    const clipEnd = clipStart + toSeconds(clip.duration)

    const attached = remainingConnected.filter((cc) => {
      const ccStart = toSeconds(cc.offset)
      return ccStart >= clipStart && ccStart < clipEnd
    })

    if (attached.length > 0) {
      node.children = node.children ?? []
      for (const cc of attached) {
        const ccAsset = assetMap.get(cc.assetId)
        if (!ccAsset) throw new Error(`Asset not found: ${cc.assetId}`)
        const ccNode = buildAssetClipNode(cc, ccAsset, volumeDb)
        if (!ccNode.attrs!.lane) {
          ccNode.attrs!.lane = String(cc.lane ?? 1)
        }
        node.children.push(ccNode)
      }
      remainingConnected = remainingConnected.filter(
        (c) => !attached.includes(c),
      )
    }

    spineChildren.push(node)
    currentTime = add(clip.offset, clip.duration)
  }

  if (remainingConnected.length > 0) {
    const maxEnd = remainingConnected.reduce((max, cc) => {
      const end = add(cc.offset, cc.duration)
      return toSeconds(end) > toSeconds(max) ? end : max
    }, currentTime)

    const gapDuration = subtract(maxEnd, currentTime)
    const gapNode: XMLNode = {
      tag: "gap",
      attrs: {
        name: "Gap",
        offset: toFCPString(currentTime),
        duration: toFCPString(gapDuration),
        start: "0s",
      },
    }

    gapNode.children = []
    for (const cc of remainingConnected) {
      const ccAsset = assetMap.get(cc.assetId)
      if (!ccAsset) throw new Error(`Asset not found: ${cc.assetId}`)
      const ccNode = buildAssetClipNode(cc, ccAsset, volumeDb)
      if (!ccNode.attrs!.lane) {
        ccNode.attrs!.lane = String(cc.lane ?? 1)
      }
      gapNode.children.push(ccNode)
    }

    spineChildren.push(gapNode)
  }

  const fd = frameDuration(timeline.format.frameRate)
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
          ...timeline.assets.map((a) => buildAssetNode(a, formatId)),
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
                      tcStart: "0s",
                      tcFormat: "NDF",
                      audioLayout: "stereo",
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
