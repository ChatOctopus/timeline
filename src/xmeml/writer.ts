import type {
  Timeline,
  ExportOptions,
  ExternalReference,
  Rational,
} from "../types.js"
import {
  toFrames,
  frameDuration,
  isNTSC,
  isDropFrame,
  nominalFrameRate,
  ZERO,
  add,
} from "../time.js"
import { validateTimeline } from "../validate.js"
import {
  clipDuration,
  collectAdapterResources,
  makeWarningEmitter,
  mediaCapabilities,
  normalizeTargetUrl,
  sequenceAudioChannels,
  warnOnUnsupportedExportFeatures,
} from "../adapter-core.js"
import { timelineDuration, trackClipPlacements } from "../timeline-logic.js"

function escapeXml(value: string): string {
  return value
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
          .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
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

  toString(): string {
    return this.lines.join("\n") + "\n"
  }
}

interface AdapterResourceRecord {
  id: string
  reference: ExternalReference
}

interface ClipPayload {
  clip: Timeline["tracks"][number]["items"][number] & { kind: "clip" }
  resource: AdapterResourceRecord
  timelineStart: number
  timelineEnd: number
  sourceIn: number
  sourceOut: number
  resourceFrameRate: Rational
  videoClipId?: string
  audioClipId?: string
  fileId: string
  index: number
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
  reference: ExternalReference,
  inferredDuration: { num: number; den: number },
  frameRate: Rational,
): void {
  const caps = mediaCapabilities(reference)
  const availableRange = reference.availableRange ?? {
    startTime: ZERO,
    duration: inferredDuration,
  }
  const fd = frameDuration(frameRate)
  const durationFrames = toFrames(availableRange.duration, fd)
  const timecodeFrames = toFrames(availableRange.startTime, fd)

  xml.open("file", { id: fileId })
  xml.leaf("name", reference.name ?? reference.targetUrl.split("/").pop() ?? fileId)
  xml.leaf("pathurl", normalizeTargetUrl(reference.targetUrl))
  writeRate(xml, frameRate)
  xml.leaf("duration", String(durationFrames))
  xml.open("timecode")
  writeRate(xml, frameRate)
  xml.leaf("frame", String(timecodeFrames))
  xml.leaf("displayformat", isDropFrame(frameRate) ? "DF" : "NDF")
  xml.close("timecode")
  xml.open("media")
  if (caps.hasVideo) {
    xml.open("video")
    writeSampleCharacteristics(xml, frameRate, caps.width ?? 1920, caps.height ?? 1080)
    xml.close("video")
  }
  if (caps.hasAudio) {
    xml.open("audio")
    xml.open("samplecharacteristics")
    xml.leaf("samplerate", String(caps.audioRate ?? 48000))
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

function buildPayloads(
  timeline: Timeline,
  track: Timeline["tracks"][number],
  resources: ReturnType<typeof collectAdapterResources>,
  indexOffset: number,
  emitWarning: (warning: string) => void,
): ClipPayload[] {
  const resourceMap = new Map(resources.map((resource) => [resource.reference.targetUrl, resource]))
  const tlFd = frameDuration(timeline.format.frameRate)

  return trackClipPlacements(track, {
    transitionPolicy: "drop",
    onUnsupportedTransition() {
      emitWarning("Transitions are not supported in this export format and were dropped")
    },
  }).flatMap((placement, index) => {
    if (placement.clip.mediaReference.type !== "external") {
      emitWarning("Missing media references are not supported in this export format and were dropped")
      return []
    }

    const resource = resourceMap.get(normalizeTargetUrl(placement.clip.mediaReference.targetUrl))
    if (!resource) return []

    const resourceFrameRate = placement.clip.mediaReference.streamInfo?.frameRate ?? timeline.format.frameRate
    const resourceFd = frameDuration(resourceFrameRate)
    const availableStart = placement.clip.mediaReference.availableRange?.startTime ?? ZERO
    const sourceStart = add(availableStart, placement.clip.sourceRange?.startTime ?? ZERO)
    const sourceDuration = clipDuration(placement.clip)
    const clipIndex = indexOffset + index + 1
    const caps = mediaCapabilities(placement.clip.mediaReference)

    return [{
      clip: placement.clip,
      resource: {
        id: resource.id,
        reference: resource.reference,
      },
      timelineStart: toFrames(placement.offset, tlFd),
      timelineEnd: toFrames(add(placement.offset, sourceDuration), tlFd),
      sourceIn: toFrames(sourceStart, resourceFd),
      sourceOut: toFrames(add(sourceStart, sourceDuration), resourceFd),
      resourceFrameRate,
      videoClipId: caps.hasVideo ? `clipitem-video-${clipIndex}` : undefined,
      audioClipId: caps.hasAudio ? `clipitem-audio-${clipIndex}` : undefined,
      fileId: `file-${resource.id}`,
      index: clipIndex,
    }]
  })
}

/**
 * Generate FCP7 XML (xmeml v5) from a Timeline.
 */
export function writeXMEML(
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

  const tlFrameRate = timeline.format.frameRate
  const tlFd = frameDuration(tlFrameRate)
  const sequenceDurationFrames = toFrames(
    timelineDuration(timeline, {
      transitionPolicy: "drop",
      onUnsupportedTransition() {
        emitWarning("Transitions are not supported in this export format and were dropped")
      },
    }),
    tlFd,
  )
  const sequenceTimecodeFrames = toFrames(timeline.globalStartTime ?? ZERO, tlFd)
  const resources = collectAdapterResources(timeline)

  const videoTracks = timeline.tracks.filter((track) => track.kind === "video")
  const audioTracks = timeline.tracks.filter((track) => track.kind === "audio")

  let globalIndex = 0
  const videoPayloads = videoTracks.map((track) => {
    const payloads = buildPayloads(timeline, track, resources, globalIndex, emitWarning)
    globalIndex += payloads.length
    return payloads
  })
  const audioOnlyPayloads = audioTracks.map((track) => {
    const payloads = buildPayloads(timeline, track, resources, globalIndex, emitWarning).map((payload) => ({
      ...payload,
      videoClipId: undefined,
    }))
    globalIndex += payloads.length
    return payloads
  })

  const xml = new XMLBuilder()
  xml.raw(`<?xml version="1.0" encoding="UTF-8"?>`)
  xml.raw(`<!DOCTYPE xmeml>`)
  xml.open("xmeml", { version: "5" })
  xml.open("sequence", { id: "sequence-1" })
  xml.leaf("name", timeline.name)
  xml.leaf("duration", String(sequenceDurationFrames))
  writeRate(xml, tlFrameRate)
  xml.leaf("in", "0")
  xml.leaf("out", String(sequenceDurationFrames))
  xml.open("timecode")
  writeRate(xml, tlFrameRate)
  xml.leaf("frame", String(sequenceTimecodeFrames))
  xml.leaf("displayformat", isDropFrame(tlFrameRate) ? "DF" : "NDF")
  xml.close("timecode")
  xml.open("media")

  xml.open("video")
  xml.open("format")
  writeSampleCharacteristics(xml, tlFrameRate, timeline.format.width, timeline.format.height)
  xml.close("format")
  for (let trackIndex = 0; trackIndex < videoPayloads.length; trackIndex++) {
    xml.open("track")
    for (const payload of videoPayloads[trackIndex]) {
      if (!payload.videoClipId) continue

      xml.open("clipitem", { id: payload.videoClipId })
      xml.leaf("name", payload.clip.name)
      xml.leaf("enabled", payload.clip.enabled === false ? "FALSE" : "TRUE")
      xml.leaf("duration", String(payload.timelineEnd - payload.timelineStart))
      xml.leaf("start", String(payload.timelineStart))
      xml.leaf("end", String(payload.timelineEnd))
      xml.leaf("in", String(payload.sourceIn))
      xml.leaf("out", String(payload.sourceOut))
      const resource = resources.find((entry) => entry.id === payload.resource.id)!
      writeFileElement(xml, payload.fileId, payload.resource.reference, resource.inferredDuration, payload.resourceFrameRate)
      xml.open("sourcetrack")
      xml.leaf("mediatype", "video")
      xml.leaf("trackindex", String(trackIndex + 1))
      xml.close("sourcetrack")
      writeLinkEntries(xml, payload.videoClipId, payload.audioClipId, payload.index, trackIndex + 1)
      xml.close("clipitem")
    }
    xml.close("track")
  }
  xml.close("video")

  xml.open("audio")
  xml.leaf("numOutputChannels", String(sequenceAudioChannels(timeline.format)))
  xml.open("format")
  xml.open("samplecharacteristics")
  xml.leaf("samplerate", String(timeline.format.audioRate))
  xml.leaf("sampledepth", "16")
  xml.close("samplecharacteristics")
  xml.close("format")

  const combinedAudioTracks = [...videoPayloads, ...audioOnlyPayloads]
  for (let trackIndex = 0; trackIndex < combinedAudioTracks.length; trackIndex++) {
    xml.open("track")
    for (const payload of combinedAudioTracks[trackIndex]) {
      if (!payload.audioClipId) continue

      xml.open("clipitem", { id: payload.audioClipId })
      xml.leaf("name", payload.clip.name)
      xml.leaf("enabled", payload.clip.enabled === false ? "FALSE" : "TRUE")
      xml.leaf("duration", String(payload.timelineEnd - payload.timelineStart))
      xml.leaf("start", String(payload.timelineStart))
      xml.leaf("end", String(payload.timelineEnd))
      xml.leaf("in", String(payload.sourceIn))
      xml.leaf("out", String(payload.sourceOut))
      const resource = resources.find((entry) => entry.id === payload.resource.id)!
      writeFileElement(xml, payload.fileId, payload.resource.reference, resource.inferredDuration, payload.resourceFrameRate)
      xml.open("sourcetrack")
      xml.leaf("mediatype", "audio")
      xml.leaf("trackindex", String(trackIndex + 1))
      xml.close("sourcetrack")
      writeLinkEntries(xml, payload.videoClipId, payload.audioClipId, payload.index, trackIndex + 1)
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
