import type { NLETimeline, NLEAsset, NLEClip, ExportOptions } from "../types.js"
import {
  toFrames,
  frameDuration,
  isNTSC,
  isDropFrame,
  nominalFrameRate,
  ZERO,
  isZero,
  add,
} from "../time.js"
import { validateTimeline, computeTimelineDuration } from "../validate.js"
import type { Rational } from "../types.js"
import { toFileUrl } from "../file-url.js"

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

class XMLBuilder {
  private lines: string[] = []
  private depth = 0

  raw(text: string): void {
    this.lines.push(text)
  }

  open(tag: string, attrs?: Record<string, string>): void {
    const pad = "  ".repeat(this.depth)
    const attrStr = attrs
      ? Object.entries(attrs)
          .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
          .join("")
      : ""
    this.lines.push(`${pad}<${tag}${attrStr}>`)
    this.depth++
  }

  close(tag: string): void {
    this.depth--
    const pad = "  ".repeat(this.depth)
    this.lines.push(`${pad}</${tag}>`)
  }

  leaf(tag: string, content: string): void {
    const pad = "  ".repeat(this.depth)
    this.lines.push(`${pad}<${tag}>${escapeXml(content)}</${tag}>`)
  }

  selfClose(tag: string, attrs?: Record<string, string>): void {
    const pad = "  ".repeat(this.depth)
    const attrStr = attrs
      ? Object.entries(attrs)
          .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
          .join("")
      : ""
    this.lines.push(`${pad}<${tag}${attrStr}/>`)
  }

  toString(): string {
    return this.lines.join("\n") + "\n"
  }
}

function writeRate(xml: XMLBuilder, frameRate: Rational): void {
  xml.open("rate")
  xml.leaf("timebase", String(nominalFrameRate(frameRate)))
  xml.leaf("ntsc", isNTSC(frameRate) ? "TRUE" : "FALSE")
  xml.close("rate")
}

function writeSampleCharacteristics(
  xml: XMLBuilder,
  frameRate: Rational,
  width: number,
  height: number,
): void {
  xml.open("samplecharacteristics")
  writeRate(xml, frameRate)
  xml.leaf("width", String(width))
  xml.leaf("height", String(height))
  xml.leaf("anamorphic", "FALSE")
  xml.leaf("pixelaspectratio", "square")
  xml.leaf("fielddominance", "none")
  xml.close("samplecharacteristics")
}

function writeFileElement(
  xml: XMLBuilder,
  fileId: string,
  asset: NLEAsset,
  assetFrameRate: Rational,
): void {
  const fd = frameDuration(assetFrameRate)
  const assetDurationFrames = toFrames(asset.duration, fd)
  const tcStartFrames = toFrames(asset.timecodeStart ?? ZERO, fd)
  const audioRate = String(asset.audioRate ?? 48000)
  const width = asset.videoFormat?.width ?? 1920
  const height = asset.videoFormat?.height ?? 1080

  xml.open("file", { id: fileId })
  xml.leaf("name", asset.name)
  xml.leaf("pathurl", toFileUrl(asset.path))
  writeRate(xml, assetFrameRate)
  xml.leaf("duration", String(assetDurationFrames))
  xml.open("timecode")
  writeRate(xml, assetFrameRate)
  xml.leaf("frame", String(tcStartFrames))
  xml.leaf("displayformat", isDropFrame(assetFrameRate) ? "DF" : "NDF")
  xml.close("timecode")
  xml.open("media")
  if (asset.hasVideo) {
    xml.open("video")
    writeSampleCharacteristics(xml, assetFrameRate, width, height)
    xml.close("video")
  }
  if (asset.hasAudio) {
    xml.open("audio")
    xml.open("samplecharacteristics")
    xml.leaf("samplerate", audioRate)
    xml.leaf("sampledepth", "16")
    xml.close("samplecharacteristics")
    xml.close("audio")
  }
  xml.close("media")
  xml.close("file")
}

function writeLinkEntries(
  xml: XMLBuilder,
  videoClipId: string | undefined,
  audioClipId: string | undefined,
  clipIndex: number,
  trackIndex: number,
): void {
  if (videoClipId) {
    xml.open("link")
    xml.leaf("linkclipref", videoClipId)
    xml.leaf("mediatype", "video")
    xml.leaf("trackindex", String(trackIndex))
    xml.leaf("clipindex", String(clipIndex))
    xml.close("link")
  }
  if (audioClipId) {
    xml.open("link")
    xml.leaf("linkclipref", audioClipId)
    xml.leaf("mediatype", "audio")
    xml.leaf("trackindex", String(trackIndex))
    xml.leaf("clipindex", String(clipIndex))
    xml.leaf("groupindex", "1")
    xml.close("link")
  }
}

interface ClipPayload {
  index: number
  clip: NLEClip
  asset: NLEAsset
  videoClipId?: string
  audioClipId?: string
  fileId: string
  timelineStart: number
  timelineEnd: number
  sourceIn: number
  sourceOut: number
  assetFrameRate: Rational
}

function buildPayloads(
  clips: NLEClip[],
  assetMap: Map<string, NLEAsset>,
  timelineFrameRate: Rational,
  indexOffset = 0,
): ClipPayload[] {
  const tlFd = frameDuration(timelineFrameRate)

  return clips.map((clip, i) => {
    const asset = assetMap.get(clip.assetId)
    if (!asset) throw new Error(`Asset not found: ${clip.assetId}`)

    const assetFrameRate = asset.videoFormat?.frameRate ?? timelineFrameRate
    const assetFd = frameDuration(assetFrameRate)

    const timelineStart = toFrames(clip.offset, tlFd)
    const timelineDuration = toFrames(clip.duration, tlFd)
    const timelineEnd = timelineStart + timelineDuration

    const tcStartFrames = toFrames(asset.timecodeStart ?? ZERO, assetFd)
    const sourceIn = toFrames(clip.sourceIn, assetFd) + tcStartFrames
    const sourceDuration = toFrames(clip.sourceDuration, assetFd)
    const sourceOut = sourceIn + sourceDuration

    const idx = i + 1 + indexOffset
    return {
      index: idx,
      clip,
      asset,
      videoClipId: `clipitem-video-${idx}`,
      audioClipId: `clipitem-audio-${idx}`,
      fileId: `file-${asset.id}`,
      timelineStart,
      timelineEnd,
      sourceIn,
      sourceOut,
      assetFrameRate,
    }
  })
}

/**
 * Generate FCP7 XML (xmeml v5) from an NLETimeline.
 * Compatible with Adobe Premiere Pro and DaVinci Resolve.
 */
export function writeXMEML(
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

  const assetMap = new Map(timeline.assets.map((a) => [a.id, a]))
  const tlFrameRate = timeline.format.frameRate
  const tlFd = frameDuration(tlFrameRate)
  const sequenceDuration = computeTimelineDuration(timeline)
  const sequenceDurationFrames = toFrames(sequenceDuration, tlFd)
  const audioRate = String(timeline.format.audioRate)

  const videoTracks = timeline.tracks.filter((t) => t.type === "video")
  const allTrackPayloads: { payloads: ClipPayload[]; trackIndex: number }[] = []
  let globalIndex = 0
  let trackIndex = 1
  for (const vTrack of videoTracks) {
    const sorted = [...vTrack.clips].sort(
      (a, b) => a.offset.num / a.offset.den - b.offset.num / b.offset.den,
    )
    const trackPayloads = buildPayloads(sorted, assetMap, tlFrameRate, globalIndex)
    allTrackPayloads.push({ payloads: trackPayloads, trackIndex })
    globalIndex += trackPayloads.length
    trackIndex++
  }

  const audioTracks = timeline.tracks.filter((t) => t.type === "audio")
  const audioOnlyPayloads: { payloads: ClipPayload[]; trackIndex: number }[] = []
  let aTrackIndex = trackIndex
  for (const aTrack of audioTracks) {
    const sorted = [...aTrack.clips].sort(
      (a, b) => a.offset.num / a.offset.den - b.offset.num / b.offset.den,
    )
    const trackPayloads = buildPayloads(sorted, assetMap, tlFrameRate, globalIndex)
    // Clear videoClipId for audio-only tracks so they don't link to non-existent video
    for (const p of trackPayloads) {
      p.videoClipId = undefined
    }
    audioOnlyPayloads.push({ payloads: trackPayloads, trackIndex: aTrackIndex })
    globalIndex += trackPayloads.length
    aTrackIndex++
  }

  const sequenceId = `sequence-1`

  const xml = new XMLBuilder()
  xml.raw(`<?xml version="1.0" encoding="UTF-8"?>`)
  xml.raw(`<!DOCTYPE xmeml>`)
  xml.open("xmeml", { version: "5" })
  xml.open("sequence", { id: sequenceId })
  xml.leaf("name", timeline.name)
  xml.leaf("duration", String(sequenceDurationFrames))
  writeRate(xml, tlFrameRate)
  xml.leaf("in", "0")
  xml.leaf("out", String(sequenceDurationFrames))
  xml.open("timecode")
  writeRate(xml, tlFrameRate)
  xml.leaf("frame", "0")
  xml.leaf("displayformat", isDropFrame(tlFrameRate) ? "DF" : "NDF")
  xml.close("timecode")

  xml.open("media")

  xml.open("video")
  xml.open("format")
  writeSampleCharacteristics(
    xml,
    tlFrameRate,
    timeline.format.width,
    timeline.format.height,
  )
  xml.close("format")
  for (const { payloads: trackPayloads, trackIndex } of allTrackPayloads) {
    xml.open("track")
    for (const payload of trackPayloads) {
      xml.open("clipitem", { id: payload.videoClipId! })
      xml.leaf("name", payload.clip.name || payload.asset.name.replace(/\.[^.]+$/, ""))
      xml.leaf("enabled", "TRUE")
      xml.leaf("duration", String(payload.timelineEnd - payload.timelineStart))
      xml.leaf("start", String(payload.timelineStart))
      xml.leaf("end", String(payload.timelineEnd))
      xml.leaf("in", String(payload.sourceIn))
      xml.leaf("out", String(payload.sourceOut))
      writeFileElement(xml, payload.fileId, payload.asset, payload.assetFrameRate)
      xml.open("sourcetrack")
      xml.leaf("mediatype", "video")
      xml.leaf("trackindex", String(trackIndex))
      xml.close("sourcetrack")
      writeLinkEntries(
        xml,
        payload.videoClipId,
        payload.audioClipId,
        payload.index,
        trackIndex,
      )
      xml.close("clipitem")
    }
    xml.close("track")
  }
  xml.close("video")

  xml.open("audio")
  xml.leaf("numOutputChannels", "2")
  xml.open("format")
  xml.open("samplecharacteristics")
  xml.leaf("samplerate", audioRate)
  xml.leaf("sampledepth", "16")
  xml.close("samplecharacteristics")
  xml.close("format")
  const combinedAudio = [...allTrackPayloads, ...audioOnlyPayloads]
  for (const { payloads: trackPayloads, trackIndex } of combinedAudio) {
    xml.open("track")
    for (const payload of trackPayloads) {
      xml.open("clipitem", { id: payload.audioClipId! })
      xml.leaf("name", payload.clip.name || payload.asset.name.replace(/\.[^.]+$/, ""))
      xml.leaf("enabled", "TRUE")
      xml.leaf("duration", String(payload.timelineEnd - payload.timelineStart))
      xml.leaf("start", String(payload.timelineStart))
      xml.leaf("end", String(payload.timelineEnd))
      xml.leaf("in", String(payload.sourceIn))
      xml.leaf("out", String(payload.sourceOut))
      writeFileElement(xml, payload.fileId, payload.asset, payload.assetFrameRate)
      xml.open("sourcetrack")
      xml.leaf("mediatype", "audio")
      xml.leaf("trackindex", String(trackIndex))
      xml.close("sourcetrack")
      xml.leaf("channelcount", "2")
      writeLinkEntries(
        xml,
        payload.videoClipId,
        payload.audioClipId,
        payload.index,
        trackIndex,
      )
      xml.close("clipitem")
    }
    xml.close("track")
  }
  xml.close("audio")

  xml.close("media")
  xml.close("sequence")
  xml.close("xmeml")

  return xml.toString()
}
