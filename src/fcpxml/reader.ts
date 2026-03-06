import { XMLParser } from "fast-xml-parser"
import type {
  NLETimeline,
  NLEAsset,
  NLEClip,
  NLETrack,
  NLEFormat,
  ImportResult,
} from "../types.js"
import { parseFCPString, ZERO, rational, toSeconds, subtractUnclamped } from "../time.js"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
})

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return []
  return Array.isArray(val) ? val : [val]
}

function fileUrlToPath(url: string): string {
  if (url.startsWith("file://")) {
    return decodeURIComponent(url.slice(7))
  }
  return url
}

/**
 * Parse an FCPXML string into an NLETimeline.
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

  const resources = fcpxml.resources
  const formats = ensureArray(resources.format)
  const rawAssets = ensureArray(resources.asset)

  const formatMap = new Map<string, any>()
  for (const fmt of formats) {
    formatMap.set(fmt["@_id"], fmt)
  }

  const primaryFormat = formats[0]
  let frameRate = rational(24, 1)
  let width = 1920
  let height = 1080
  let colorSpace: string | undefined

  if (primaryFormat) {
    if (primaryFormat["@_frameDuration"]) {
      const fd = parseFCPString(primaryFormat["@_frameDuration"])
      if (fd.num > 0 && fd.den > 0) {
        frameRate = rational(fd.den, fd.num)
      }
    }
    width = parseInt(primaryFormat["@_width"] ?? "1920", 10)
    height = parseInt(primaryFormat["@_height"] ?? "1080", 10)
    colorSpace = primaryFormat["@_colorSpace"]
  }

  const audioRateStr = findAudioRate(fcpxml)
  const audioRate = parseAudioRate(audioRateStr)

  const timelineFormat: NLEFormat = {
    width,
    height,
    frameRate,
    audioRate,
    colorSpace,
  }

  const assets: NLEAsset[] = rawAssets.map((a: any) => {
    const src = a["@_src"] ?? a?.["media-rep"]?.["@_src"] ?? ""
    const assetFormatId = a["@_format"]
    const assetFormat = assetFormatId
      ? formatMap.get(assetFormatId)
      : primaryFormat

    let assetFrameRate = frameRate
    if (assetFormat?.["@_frameDuration"]) {
      const fd = parseFCPString(assetFormat["@_frameDuration"])
      if (fd.num > 0 && fd.den > 0) {
        assetFrameRate = rational(fd.den, fd.num)
      }
    }

    const assetAudioRate = a["@_audioRate"]
      ? parseAudioRate(a["@_audioRate"])
      : audioRate

    return {
      id: a["@_id"] ?? "",
      name: a["@_name"] ?? "",
      path: fileUrlToPath(src),
      duration: a["@_duration"] ? parseFCPString(a["@_duration"]) : ZERO,
      hasVideo: a["@_hasVideo"] === "1",
      hasAudio: a["@_hasAudio"] === "1",
      videoFormat: {
        width: assetFormat
          ? parseInt(assetFormat["@_width"] ?? String(width), 10)
          : width,
        height: assetFormat
          ? parseInt(assetFormat["@_height"] ?? String(height), 10)
          : height,
        frameRate: assetFrameRate,
        audioRate: assetAudioRate,
        colorSpace: assetFormat?.["@_colorSpace"] ?? colorSpace,
      },
      audioChannels: a["@_audioChannels"]
        ? parseInt(a["@_audioChannels"], 10)
        : undefined,
      audioRate: assetAudioRate,
      timecodeStart: a["@_start"] ? parseFCPString(a["@_start"]) : ZERO,
    }
  })

  const clips: NLEClip[] = []
  const library = fcpxml.library
  if (library) {
    const events = ensureArray(library.event)
    for (const event of events) {
      const projects = ensureArray(event.project)
      for (const project of projects) {
        const sequences = ensureArray(project.sequence)
        for (const seq of sequences) {
          const spine = seq.spine
          if (spine) {
            extractSpineClips(spine, clips, assets, warnings)
          }
        }
      }
    }
  }

  const videoClips: NLEClip[] = []
  const audioOnlyClips: NLEClip[] = []
  for (const c of clips) {
    const asset = assets.find((a) => a.id === c.assetId)
    if (asset?.hasVideo === false && asset?.hasAudio === true) {
      audioOnlyClips.push(c)
    } else {
      videoClips.push(c)
    }
  }

  const tracks: NLETrack[] = []

  const laneMap = new Map<number, NLEClip[]>()
  for (const clip of videoClips) {
    const lane = clip.lane ?? 0
    if (!laneMap.has(lane)) laneMap.set(lane, [])
    laneMap.get(lane)!.push(clip)
  }
  const sortedLanes = [...laneMap.keys()].sort((a, b) => a - b)
  for (const lane of sortedLanes) {
    tracks.push({ type: "video", clips: laneMap.get(lane)! })
  }

  if (audioOnlyClips.length > 0) {
    tracks.push({ type: "audio", clips: audioOnlyClips })
  }

  const timelineName = findTimelineName(fcpxml) ?? "Untitled"

  return {
    timeline: {
      name: timelineName,
      format: timelineFormat,
      tracks,
      assets,
    },
    warnings,
  }
}

function extractAssetClip(
  ac: any,
  assets: NLEAsset[],
  warnings: string[],
): NLEClip {
  const assetId = ac["@_ref"] ?? ""
  const asset = assets.find((a) => a.id === assetId)

  const offset = ac["@_offset"] ? parseFCPString(ac["@_offset"]) : ZERO
  const duration = ac["@_duration"] ? parseFCPString(ac["@_duration"]) : ZERO
  const start = ac["@_start"] ? parseFCPString(ac["@_start"]) : ZERO

  let sourceIn = start
  if (asset?.timecodeStart && toSeconds(asset.timecodeStart) > 0) {
    const raw = subtractUnclamped(start, asset.timecodeStart)
    sourceIn = raw.num < 0 ? ZERO : raw
  }

  return {
    assetId,
    name: ac["@_name"] ?? asset?.name ?? "",
    offset,
    duration,
    sourceIn,
    sourceDuration: duration,
    lane: ac["@_lane"] ? parseInt(ac["@_lane"], 10) : undefined,
    audioRole: ac["@_audioRole"],
  }
}

function extractConnectedClips(
  parent: any,
  clips: NLEClip[],
  assets: NLEAsset[],
  warnings: string[],
): void {
  const connected = ensureArray(parent["asset-clip"])
  for (const cc of connected) {
    if (!cc["@_lane"]) continue
    clips.push(extractAssetClip(cc, assets, warnings))
  }
}

const UNSUPPORTED_SPINE_ELEMENTS = [
  "clip", "mc-clip", "sync-clip", "ref-clip", "audition", "title",
] as const

function extractSpineClips(
  spine: any,
  clips: NLEClip[],
  assets: NLEAsset[],
  warnings: string[],
): void {
  const assetClips = ensureArray(spine["asset-clip"])
  for (const ac of assetClips) {
    clips.push(extractAssetClip(ac, assets, warnings))
    extractConnectedClips(ac, clips, assets, warnings)
  }

  const gaps = ensureArray(spine.gap)
  for (const gap of gaps) {
    const gapConnected = ensureArray(gap["asset-clip"])
    for (const cc of gapConnected) {
      clips.push(extractAssetClip(cc, assets, warnings))
    }
  }

  for (const tag of UNSUPPORTED_SPINE_ELEMENTS) {
    const elements = ensureArray(spine[tag])
    if (elements.length > 0) {
      warnings.push(
        `<${tag}> elements are not yet supported (${elements.length} skipped)`,
      )
    }
  }
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

function findAudioRate(fcpxml: any): string {
  const library = fcpxml.library
  if (!library) return "48000"
  const events = ensureArray(library.event)
  for (const event of events) {
    const projects = ensureArray(event.project)
    for (const project of projects) {
      const sequences = ensureArray(project.sequence)
      for (const seq of sequences) {
        if (seq["@_audioRate"]) return seq["@_audioRate"]
      }
    }
  }
  return "48000"
}

function parseAudioRate(rate: string): number {
  if (rate.endsWith("k")) {
    return parseInt(rate, 10) * 1000
  }
  return parseInt(rate, 10) || 48000
}
