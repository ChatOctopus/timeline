import { XMLParser } from "fast-xml-parser"
import type {
  NLETimeline,
  NLEAsset,
  NLEClip,
  NLETrack,
  NLEFormat,
  ImportResult,
} from "../types.js"
import { rational, ZERO } from "../time.js"

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

function extractRate(rateNode: any): { num: number; den: number } {
  if (!rateNode) return { num: 24, den: 1 }
  const timebase = parseInt(rateNode.timebase ?? "24", 10)
  const ntsc = rateNode.ntsc === "TRUE"
  return ntsc ? { num: timebase * 1000, den: 1001 } : { num: timebase, den: 1 }
}

/**
 * Parse FCP7 XML (xmeml v5) into an NLETimeline.
 * Compatible with Premiere Pro and DaVinci Resolve exports.
 */
export function readXMEML(xmlString: string): ImportResult {
  const warnings: string[] = []
  const parsed = parser.parse(xmlString)
  const xmeml = parsed.xmeml

  if (!xmeml) {
    throw new Error("Invalid xmeml: missing <xmeml> root element")
  }

  const version = xmeml["@_version"]
  if (version && version !== "5") {
    warnings.push(`xmeml version ${version} may not be fully supported (expected 5)`)
  }

  const sequence = xmeml.sequence
  if (!sequence) {
    throw new Error("Invalid xmeml: missing <sequence> element")
  }

  if (!sequence.media) {
    throw new Error("Invalid xmeml: <sequence> has no <media> element")
  }

  const seqRate = extractRate(sequence.rate)
  const frameRate = rational(seqRate.num, seqRate.den)

  const media = sequence.media
  const videoSection = media?.video
  const audioSection = media?.audio

  let width = 1920
  let height = 1080
  if (videoSection?.format?.samplecharacteristics) {
    const sc = videoSection.format.samplecharacteristics
    width = parseInt(sc.width ?? "1920", 10)
    height = parseInt(sc.height ?? "1080", 10)
  }

  let audioRate = 48000
  if (audioSection?.format?.samplecharacteristics) {
    audioRate = parseInt(
      audioSection.format.samplecharacteristics.samplerate ?? "48000",
      10,
    )
  }

  const format: NLEFormat = {
    width,
    height,
    frameRate,
    audioRate,
  }

  const assetMap = new Map<string, NLEAsset>()
  const nleTracks: NLETrack[] = []

  function mergeAsset(asset: NLEAsset): void {
    const existing = assetMap.get(asset.id)
    if (!existing) {
      assetMap.set(asset.id, asset)
    } else if (asset.path && !existing.path) {
      assetMap.set(asset.id, asset)
    }
  }

  if (videoSection) {
    const tracks = ensureArray(videoSection.track)
    for (const track of tracks) {
      const trackClips: NLEClip[] = []
      const clipItems = ensureArray(track.clipitem)
      for (const item of clipItems) {
        const { clip, asset } = parseClipItem(item, frameRate, format, warnings)
        if (asset) mergeAsset(asset)
        if (clip) trackClips.push(clip)
      }
      if (trackClips.length > 0) {
        nleTracks.push({ type: "video", clips: trackClips })
      }
    }
  }

  if (audioSection) {
    const tracks = ensureArray(audioSection.track)
    for (const track of tracks) {
      const trackClips: NLEClip[] = []
      const clipItems = ensureArray(track.clipitem)
      for (const item of clipItems) {
        const { clip, asset } = parseClipItem(item, frameRate, format, warnings)
        if (asset) mergeAsset(asset)
        if (clip) trackClips.push(clip)
      }
      if (trackClips.length > 0) {
        nleTracks.push({ type: "audio", clips: trackClips })
      }
    }
  }

  return {
    timeline: {
      name: sequence.name ?? "Untitled",
      format,
      tracks: nleTracks,
      assets: Array.from(assetMap.values()),
    },
    warnings,
  }
}

function parseClipItem(
  item: any,
  timelineFrameRate: { num: number; den: number },
  timelineFormat: NLEFormat,
  warnings: string[],
): { clip: NLEClip | null; asset: NLEAsset | null } {
  const file = item.file
  if (!file) {
    warnings.push(`Clip "${item.name ?? "unknown"}" has no file reference`)
    return { clip: null, asset: null }
  }

  const fileId = file["@_id"] ?? ""
  const fileName = file.name ?? ""
  const pathUrl = file.pathurl ?? ""
  const filePath = fileUrlToPath(pathUrl)

  if (!pathUrl && fileId) {
    warnings.push(
      `File "${fileId}" has incomplete metadata (sparse/missing reference)`,
    )
  }

  const fileRate = file.rate
    ? extractRate(file.rate)
    : { num: timelineFrameRate.num, den: timelineFrameRate.den }
  const assetFrameRate = rational(fileRate.num, fileRate.den)
  const assetFd = { num: assetFrameRate.den, den: assetFrameRate.num }

  const fileDuration = parseInt(file.duration ?? "0", 10)

  let fileWidth = timelineFormat.width
  let fileHeight = timelineFormat.height
  if (file.media?.video?.samplecharacteristics) {
    const sc = file.media.video.samplecharacteristics
    fileWidth = parseInt(sc.width ?? String(fileWidth), 10)
    fileHeight = parseInt(sc.height ?? String(fileHeight), 10)
  }

  let fileAudioRate = timelineFormat.audioRate
  if (file.media?.audio?.samplecharacteristics) {
    fileAudioRate = parseInt(
      file.media.audio.samplecharacteristics.samplerate ??
        String(fileAudioRate),
      10,
    )
  }

  const tcFrame = file.timecode?.frame ? parseInt(file.timecode.frame, 10) : 0

  const asset: NLEAsset = {
    id: fileId,
    name: fileName,
    path: filePath,
    duration: rational(fileDuration * assetFd.num, assetFd.den),
    hasVideo: !!file.media?.video,
    hasAudio: !!file.media?.audio,
    videoFormat: {
      width: fileWidth,
      height: fileHeight,
      frameRate: assetFrameRate,
      audioRate: fileAudioRate,
    },
    audioChannels: 2,
    audioRate: fileAudioRate,
    timecodeStart: rational(tcFrame * assetFd.num, assetFd.den),
  }

  const tlFd = { num: timelineFrameRate.den, den: timelineFrameRate.num }
  const start = parseInt(item.start ?? "0", 10)
  const end = parseInt(item.end ?? "0", 10)
  const inPoint = parseInt(item.in ?? "0", 10)
  const outPoint = parseInt(item.out ?? "0", 10)

  const normalizedIn = inPoint - tcFrame
  const clip: NLEClip = {
    assetId: fileId,
    name: item.name ?? fileName.replace(/\.[^.]+$/, ""),
    offset: rational(start * tlFd.num, tlFd.den),
    duration: rational((end - start) * tlFd.num, tlFd.den),
    sourceIn: rational(Math.max(0, normalizedIn) * assetFd.num, assetFd.den),
    sourceDuration: rational((outPoint - inPoint) * assetFd.num, assetFd.den),
    enabled: item.enabled !== "FALSE",
  }

  return { clip, asset }
}
