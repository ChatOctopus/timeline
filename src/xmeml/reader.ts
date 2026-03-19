import { XMLParser } from "fast-xml-parser"
import type {
  Timeline,
  Clip,
  ExternalReference,
  ImportResult,
  NLEFormat,
  Track,
} from "../types.js"
import { DEFAULT_AUDIO_CHANNELS, DEFAULT_FORMAT, resolveFormatDefaults } from "../defaults.js"
import { rational, ZERO } from "../time.js"
import { trackFromPlacements } from "../adapter-core.js"
import { inferMediaKindFromTarget } from "../media-kind.js"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
})

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function extractRate(rateNode: any): { num: number; den: number } {
  if (!rateNode) return { num: 24, den: 1 }
  const timebase = parseInt(rateNode.timebase ?? "24", 10)
  const ntsc = rateNode.ntsc === "TRUE"
  return ntsc ? { num: timebase * 1000, den: 1001 } : { num: timebase, den: 1 }
}

function mergeFileNode(existing: any, incoming: any): any {
  if (!existing) return structuredClone(incoming)

  const merged = structuredClone(existing)
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === "") continue

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      merged[key] = mergeFileNode(merged[key], value)
    } else if (merged[key] === undefined || merged[key] === "") {
      merged[key] = value
    }
  }

  return merged
}

function collectMergedFiles(section: any): Map<string, any> {
  const fileMap = new Map<string, any>()
  for (const track of ensureArray(section?.track)) {
    for (const item of ensureArray(track.clipitem)) {
      const file = item.file
      if (!file?.["@_id"]) continue

      const fileId = file["@_id"]
      fileMap.set(fileId, mergeFileNode(fileMap.get(fileId), file))
    }
  }

  return fileMap
}

function referenceFromFile(
  file: any,
  timelineFrameRate: { num: number; den: number },
  timelineFormat: NLEFormat,
): ExternalReference {
  const fileRate = file.rate
    ? extractRate(file.rate)
    : { num: timelineFrameRate.num, den: timelineFrameRate.den }
  const assetFrameRate = rational(fileRate.num, fileRate.den)
  const assetFrameDuration = { num: assetFrameRate.den, den: assetFrameRate.num }
  const fileDurationFrames = parseInt(file.duration ?? "0", 10)
  const timecodeFrames = file.timecode?.frame ? parseInt(file.timecode.frame, 10) : 0
  const hasVideo = !!file.media?.video
  const hasAudio = !!file.media?.audio
  const width = file.media?.video?.samplecharacteristics
    ? parseInt(file.media.video.samplecharacteristics.width ?? String(timelineFormat.width), 10)
    : timelineFormat.width
  const height = file.media?.video?.samplecharacteristics
    ? parseInt(file.media.video.samplecharacteristics.height ?? String(timelineFormat.height), 10)
    : timelineFormat.height
  const audioRate = file.media?.audio?.samplecharacteristics
    ? parseInt(file.media.audio.samplecharacteristics.samplerate ?? String(timelineFormat.audioRate), 10)
    : timelineFormat.audioRate
  const targetUrl = file.pathurl ?? ""
  const inferredMediaKind = inferMediaKindFromTarget(targetUrl)

  return {
    type: "external",
    name: file.name ?? undefined,
    targetUrl,
    mediaKind:
      inferredMediaKind === "image"
        ? "image"
        : hasVideo
          ? "video"
          : hasAudio
            ? "audio"
            : inferredMediaKind,
    availableRange: file.duration
      ? {
          startTime: rational(timecodeFrames * assetFrameDuration.num, assetFrameDuration.den),
          duration: rational(fileDurationFrames * assetFrameDuration.num, assetFrameDuration.den),
        }
      : undefined,
    streamInfo: {
      hasVideo,
      hasAudio,
      width,
      height,
      frameRate: assetFrameRate,
      audioRate,
      audioChannels: hasAudio ? timelineFormat.audioChannels ?? DEFAULT_AUDIO_CHANNELS : undefined,
    },
  }
}

function parseClipItem(
  item: any,
  mergedFiles: Map<string, any>,
  timelineFrameRate: { num: number; den: number },
  timelineFormat: NLEFormat,
  warnings: string[],
): { clip: Clip | null; offset: { num: number; den: number } } {
  const file = item.file
  if (!file) {
    warnings.push(`Clip "${item.name ?? "unknown"}" has no file reference`)
    return { clip: null, offset: ZERO }
  }

  if (!file.pathurl && file["@_id"]) {
    warnings.push(`File "${file["@_id"]}" has incomplete metadata (sparse/missing reference)`)
  }

  const mergedFile = file["@_id"] ? mergedFiles.get(file["@_id"]) ?? file : file

  const reference = referenceFromFile(mergedFile, timelineFrameRate, timelineFormat)
  const fileRate = mergedFile.rate
    ? extractRate(mergedFile.rate)
    : { num: timelineFrameRate.num, den: timelineFrameRate.den }
  const assetFrameRate = rational(fileRate.num, fileRate.den)
  const assetFrameDuration = { num: assetFrameRate.den, den: assetFrameRate.num }
  const timelineFrameDuration = { num: timelineFrameRate.den, den: timelineFrameRate.num }
  const timecodeFrames = mergedFile.timecode?.frame ? parseInt(mergedFile.timecode.frame, 10) : 0
  const start = parseInt(item.start ?? "0", 10)
  const end = parseInt(item.end ?? "0", 10)
  const inPoint = parseInt(item.in ?? "0", 10)
  const outPoint = parseInt(item.out ?? "0", 10)

  const clip: Clip = {
    kind: "clip",
    name: item.name ?? mergedFile.name ?? "",
    mediaReference: reference.targetUrl
      ? reference
      : {
          type: "missing",
          name: mergedFile.name ?? item.name ?? undefined,
        },
    sourceRange: {
      startTime: rational(Math.max(0, inPoint - timecodeFrames) * assetFrameDuration.num, assetFrameDuration.den),
      duration: rational((outPoint - inPoint) * assetFrameDuration.num, assetFrameDuration.den),
    },
    enabled: item.enabled !== "FALSE",
  }

  return {
    clip,
    offset: rational(start * timelineFrameDuration.num, timelineFrameDuration.den),
  }
}

/**
 * Parse FCP7 XML (xmeml v5) into the core Timeline model.
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

  const sequenceRate = extractRate(sequence.rate)
  const timelineFrameRate = rational(sequenceRate.num, sequenceRate.den)
  const media = sequence.media
  const videoSection = media.video
  const audioSection = media.audio

  let width = DEFAULT_FORMAT.width
  let height = DEFAULT_FORMAT.height
  if (videoSection?.format?.samplecharacteristics) {
    width = parseInt(videoSection.format.samplecharacteristics.width ?? String(DEFAULT_FORMAT.width), 10)
    height = parseInt(videoSection.format.samplecharacteristics.height ?? String(DEFAULT_FORMAT.height), 10)
  }

  let audioRate = DEFAULT_FORMAT.audioRate
  if (audioSection?.format?.samplecharacteristics) {
    audioRate = parseInt(
      audioSection.format.samplecharacteristics.samplerate ?? String(DEFAULT_FORMAT.audioRate),
      10,
    )
  }

  const format: NLEFormat = resolveFormatDefaults({
    width,
    height,
    frameRate: timelineFrameRate,
    audioRate,
    audioChannels: audioSection?.numOutputChannels
      ? parseInt(audioSection.numOutputChannels, 10)
      : undefined,
  })

  const videoFiles = collectMergedFiles(videoSection)
  const audioFiles = collectMergedFiles(audioSection)
  const mergedFiles = new Map([...videoFiles, ...audioFiles])
  const tracks: Track[] = []

  for (const [index, track] of ensureArray(videoSection?.track).entries()) {
    const placements = ensureArray(track.clipitem)
      .map((item) => parseClipItem(item, mergedFiles, timelineFrameRate, format, warnings))
      .filter((entry): entry is { clip: Clip; offset: { num: number; den: number } } => entry.clip !== null)

    const builtTrack = trackFromPlacements("video", placements, `Video Track ${index + 1}`)
    if (builtTrack) tracks.push(builtTrack)
  }

  for (const [index, track] of ensureArray(audioSection?.track).entries()) {
    const placements = ensureArray(track.clipitem)
      .map((item) => parseClipItem(item, mergedFiles, timelineFrameRate, format, warnings))
      .filter((entry): entry is { clip: Clip; offset: { num: number; den: number } } => entry.clip !== null)

    const builtTrack = trackFromPlacements("audio", placements, `Audio Track ${index + 1}`)
    if (builtTrack) tracks.push(builtTrack)
  }

  const timeline: Timeline = {
    name: sequence.name ?? "Untitled",
    format,
    tracks,
    globalStartTime: sequence.timecode?.frame
      ? rational(
          parseInt(sequence.timecode.frame, 10) * timelineFrameRate.den,
          timelineFrameRate.num,
        )
      : ZERO,
  }

  return { timeline, warnings }
}
