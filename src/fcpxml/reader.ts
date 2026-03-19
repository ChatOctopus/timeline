import { XMLParser } from "fast-xml-parser"
import type {
  Timeline,
  Track,
  Clip,
  ExternalReference,
  ImportResult,
  NLEFormat,
  Rational,
} from "../types.js"
import {
  parseFCPString,
  ZERO,
  rational,
  toSeconds,
  subtractUnclamped,
  add,
} from "../time.js"
import { clipDuration, trackFromPlacements } from "../adapter-core.js"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
})

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function parseAudioRate(rate: string): number {
  if (rate.endsWith("k")) {
    return parseInt(rate, 10) * 1000
  }

  return parseInt(rate, 10) || 48000
}

function findTimelineName(fcpxml: any): string | null {
  const library = fcpxml.library
  if (!library) return null
  const events = ensureArray(library.event)
  if (events.length === 0) return null
  const projects = ensureArray(events[0].project)
  if (projects.length === 0) return events[0]["@_name"] ?? null
  return projects[0]["@_name"] ?? events[0]["@_name"] ?? null
}

function findSequence(fcpxml: any): any {
  const library = fcpxml.library
  if (!library) return null

  for (const event of ensureArray(library.event)) {
    for (const project of ensureArray(event.project)) {
      const sequences = ensureArray(project.sequence)
      if (sequences.length > 0) return sequences[0]
    }
  }

  return null
}

function findAudioRate(fcpxml: any): string {
  const sequence = findSequence(fcpxml)
  return sequence?.["@_audioRate"] ?? "48000"
}

function externalReferenceFromAsset(
  asset: any,
  formatNode: any,
  timelineFormat: NLEFormat,
): ExternalReference {
  let frameRate = timelineFormat.frameRate
  if (formatNode?.["@_frameDuration"]) {
    const frameDuration = parseFCPString(formatNode["@_frameDuration"])
    if (frameDuration.num > 0 && frameDuration.den > 0) {
      frameRate = rational(frameDuration.den, frameDuration.num)
    }
  }

  const audioRate = asset["@_audioRate"]
    ? parseAudioRate(asset["@_audioRate"])
    : timelineFormat.audioRate
  const hasVideo = asset["@_hasVideo"] === "1"
  const hasAudio = asset["@_hasAudio"] === "1"

  return {
    type: "external",
    name: asset["@_name"] ?? undefined,
    targetUrl: asset["@_src"] ?? asset?.["media-rep"]?.["@_src"] ?? "",
    mediaKind: hasVideo ? "video" : hasAudio ? "audio" : "unknown",
    availableRange: asset["@_duration"]
      ? {
          startTime: asset["@_start"] ? parseFCPString(asset["@_start"]) : ZERO,
          duration: parseFCPString(asset["@_duration"]),
        }
      : undefined,
    streamInfo: {
      hasVideo,
      hasAudio,
      width: formatNode ? parseInt(formatNode["@_width"] ?? String(timelineFormat.width), 10) : timelineFormat.width,
      height: formatNode ? parseInt(formatNode["@_height"] ?? String(timelineFormat.height), 10) : timelineFormat.height,
      frameRate,
      audioRate,
      audioChannels: asset["@_audioChannels"] ? parseInt(asset["@_audioChannels"], 10) : undefined,
      colorSpace: formatNode?.["@_colorSpace"] ?? timelineFormat.colorSpace,
    },
  }
}

function parseAssetClip(
  raw: any,
  resourceMap: Map<string, ExternalReference>,
): { clip: Clip; offset: Rational; kind: "video" | "audio"; lane: number } {
  const offset = raw["@_offset"] ? parseFCPString(raw["@_offset"]) : ZERO
  const duration = raw["@_duration"] ? parseFCPString(raw["@_duration"]) : ZERO
  const start = raw["@_start"] ? parseFCPString(raw["@_start"]) : ZERO
  const reference = resourceMap.get(raw["@_ref"] ?? "")

  let mediaReference: Clip["mediaReference"]
  let sourceStart = start
  let kind: "video" | "audio" = "video"

  if (!reference || reference.targetUrl === "") {
    mediaReference = {
      type: "missing",
      name: raw["@_name"] ?? undefined,
    }
  } else {
    const availableStart = reference.availableRange?.startTime ?? ZERO
    const rawSourceStart = subtractUnclamped(start, availableStart)
    sourceStart = rawSourceStart.num < 0 ? ZERO : rawSourceStart
    mediaReference = structuredClone(reference)
    kind = reference.streamInfo?.hasVideo === false && reference.streamInfo?.hasAudio === true
      ? "audio"
      : "video"
  }

  return {
    clip: {
      kind: "clip",
      name: raw["@_name"] ?? reference?.name ?? "",
      mediaReference,
      sourceRange: {
        startTime: sourceStart,
        duration,
      },
      enabled: raw["@_enabled"] !== "0",
    },
    offset,
    kind,
    lane: raw["@_lane"] ? parseInt(raw["@_lane"], 10) : 0,
  }
}

const UNSUPPORTED_SPINE_ELEMENTS = [
  "clip",
  "mc-clip",
  "sync-clip",
  "ref-clip",
  "audition",
  "title",
] as const

/**
 * Parse an FCPXML string into the core Timeline model.
 */
export function readFCPXML(xmlString: string): ImportResult {
  const warnings: string[] = []
  const parsed = parser.parse(xmlString)
  const fcpxml = parsed.fcpxml

  if (!fcpxml) {
    throw new Error("Invalid FCPXML: missing <fcpxml> root element")
  }

  const version = fcpxml["@_version"]
  if (version && !version.startsWith("1.")) {
    warnings.push(`FCPXML version ${version} may not be fully supported (expected 1.x)`)
  }

  if (!fcpxml.resources) {
    throw new Error("Invalid FCPXML: missing <resources> element")
  }

  const formats = ensureArray(fcpxml.resources.format)
  const assets = ensureArray(fcpxml.resources.asset)
  const primaryFormat = formats[0]

  let frameRate = rational(24, 1)
  let width = 1920
  let height = 1080
  let colorSpace: string | undefined

  if (primaryFormat) {
    if (primaryFormat["@_frameDuration"]) {
      const frameDuration = parseFCPString(primaryFormat["@_frameDuration"])
      if (frameDuration.num > 0 && frameDuration.den > 0) {
        frameRate = rational(frameDuration.den, frameDuration.num)
      }
    }
    width = parseInt(primaryFormat["@_width"] ?? "1920", 10)
    height = parseInt(primaryFormat["@_height"] ?? "1080", 10)
    colorSpace = primaryFormat["@_colorSpace"]
  }

  const format: NLEFormat = {
    width,
    height,
    frameRate,
    audioRate: parseAudioRate(findAudioRate(fcpxml)),
    colorSpace,
  }

  const formatMap = new Map(ensureArray(fcpxml.resources.format).map((node: any) => [node["@_id"], node]))
  const resourceMap = new Map<string, ExternalReference>()
  for (const asset of assets) {
    const formatNode = asset["@_format"] ? formatMap.get(asset["@_format"]) : primaryFormat
    resourceMap.set(asset["@_id"] ?? "", externalReferenceFromAsset(asset, formatNode, format))
  }

  const sequence = findSequence(fcpxml)
  const spine = sequence?.spine

  const primaryEntries: { offset: Rational; type: "gap" | "clip"; duration?: Rational; clip?: Clip }[] = []
  const placementsByKey = new Map<string, { kind: "video" | "audio"; lane: number; placements: { clip: Clip; offset: Rational }[] }>()

  const pushPlacement = (
    kind: "video" | "audio",
    lane: number,
    clip: Clip,
    offset: Rational,
  ) => {
    const key = `${kind}:${lane}`
    if (!placementsByKey.has(key)) {
      placementsByKey.set(key, { kind, lane, placements: [] })
    }

    placementsByKey.get(key)!.placements.push({ clip, offset })
  }

  if (spine) {
    const directAssetClips = ensureArray(spine["asset-clip"]).map((node) => ({ node, offset: node["@_offset"] ? parseFCPString(node["@_offset"]) : ZERO }))
    const directGaps = ensureArray(spine.gap).map((node) => ({ node, offset: node["@_offset"] ? parseFCPString(node["@_offset"]) : ZERO }))
    const primaryKind = directAssetClips
      .map(({ node }) => parseAssetClip(node, resourceMap).kind)
      .find((kind) => kind === "video") ?? directAssetClips[0] ? parseAssetClip(directAssetClips[0].node, resourceMap).kind : undefined

    for (const { node } of directAssetClips) {
      const parsedClip = parseAssetClip(node, resourceMap)
      if (parsedClip.lane !== 0) {
        pushPlacement(parsedClip.kind, parsedClip.lane, parsedClip.clip, parsedClip.offset)
      } else if (primaryKind && parsedClip.kind === primaryKind) {
        primaryEntries.push({
          type: "clip",
          offset: parsedClip.offset,
          clip: parsedClip.clip,
        })
      } else {
        pushPlacement(parsedClip.kind, 0, parsedClip.clip, parsedClip.offset)
      }

      for (const connectedNode of ensureArray(node["asset-clip"])) {
        const connected = parseAssetClip(connectedNode, resourceMap)
        pushPlacement(connected.kind, connected.lane || 1, connected.clip, connected.offset)
      }
    }

    for (const { node, offset } of directGaps) {
      primaryEntries.push({
        type: "gap",
        offset,
        duration: node["@_duration"] ? parseFCPString(node["@_duration"]) : ZERO,
      })

      for (const connectedNode of ensureArray(node["asset-clip"])) {
        const connected = parseAssetClip(connectedNode, resourceMap)
        pushPlacement(connected.kind, connected.lane || 1, connected.clip, connected.offset)
      }
    }

    for (const tag of UNSUPPORTED_SPINE_ELEMENTS) {
      const elements = ensureArray(spine[tag])
      if (elements.length > 0) {
        warnings.push(`<${tag}> elements are not yet supported (${elements.length} skipped)`)
      }
    }
  }

  const tracks: Track[] = []
  const sortedPrimaryEntries = [...primaryEntries].sort((a, b) => toSeconds(a.offset) - toSeconds(b.offset))
  if (sortedPrimaryEntries.length > 0) {
    const items: Track["items"] = []
    let currentOffset = ZERO

    for (const entry of sortedPrimaryEntries) {
      if (toSeconds(entry.offset) > toSeconds(currentOffset) + 0.0001) {
        items.push({
          kind: "gap",
          sourceRange: {
            startTime: ZERO,
            duration: subtractUnclamped(entry.offset, currentOffset),
          },
        })
      }

      if (entry.type === "gap") {
        items.push({
          kind: "gap",
          sourceRange: {
            startTime: ZERO,
            duration: entry.duration ?? ZERO,
          },
        })
        currentOffset = add(entry.offset, entry.duration ?? ZERO)
      } else {
        items.push(entry.clip!)
        currentOffset = add(entry.offset, clipDuration(entry.clip!))
      }
    }

    const firstPrimaryClip = sortedPrimaryEntries.find(
      (entry): entry is { offset: Rational; type: "clip"; clip: Clip } => entry.type === "clip",
    )?.clip
    const primaryKind =
      firstPrimaryClip?.mediaReference.type === "external" &&
      firstPrimaryClip.mediaReference.streamInfo?.hasVideo === false
        ? "audio"
        : "video"

    tracks.push({
      kind: primaryKind,
      name: primaryKind === "video" ? "Video Track 1" : "Audio Track 1",
      items,
    })
  }

  const remainingTracks = [...placementsByKey.values()]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "video" ? -1 : 1
      return a.lane - b.lane
    })
    .map((entry, index) =>
      trackFromPlacements(
        entry.kind,
        entry.placements,
        `${entry.kind === "video" ? "Video" : "Audio"} Track ${tracks.length + index + 1}`,
      ),
    )
    .filter((track): track is Track => track !== null)

  tracks.push(...remainingTracks)

  const timeline: Timeline = {
    name: findTimelineName(fcpxml) ?? "Untitled",
    format,
    tracks,
    globalStartTime: sequence?.["@_tcStart"] ? parseFCPString(sequence["@_tcStart"]) : ZERO,
  }

  return { timeline, warnings }
}
