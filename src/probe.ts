import { execFile } from "node:child_process"
import { basename, resolve } from "node:path"
import { promisify } from "node:util"
import type { ExternalReference, MediaKind, Rational } from "./types.js"
import { rational, ZERO, parseTimecode } from "./time.js"
import { toFileUrl } from "./file-url.js"
import { inferMediaKindFromTarget } from "./media-kind.js"

const exec = promisify(execFile)

interface FFProbeStream {
  codec_type: string
  width?: number
  height?: number
  r_frame_rate?: string
  sample_rate?: string
  channels?: number
  color_space?: string
  color_primaries?: string
  color_transfer?: string
  tags?: Record<string, string>
}

interface FFProbeFormat {
  duration?: string
  tags?: Record<string, string>
}

interface FFProbeResult {
  streams: FFProbeStream[]
  format: FFProbeFormat
}

export async function ffprobe(filePath: string): Promise<FFProbeResult> {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ])
  return JSON.parse(stdout)
}

function parseFrameRate(rateStr: string): Rational {
  const parts = rateStr.split("/")
  if (parts.length === 2) {
    return rational(parseInt(parts[0], 10), parseInt(parts[1], 10))
  }

  const fps = parseFloat(rateStr)
  if (fps === Math.round(fps)) return rational(Math.round(fps), 1)
  return rational(Math.round(fps * 1001), 1001)
}

function detectColorSpace(stream: FFProbeStream): string {
  const { color_space, color_primaries, color_transfer } = stream
  if (
    color_space === "bt709" ||
    color_primaries === "bt709" ||
    color_transfer === "bt709"
  ) {
    return "1-1-1 (Rec. 709)"
  }

  return "1-1-1 (Rec. 709)"
}

function extractTimecodeString(result: FFProbeResult): string | null {
  for (const stream of result.streams) {
    const tc = stream.tags?.timecode
    if (tc && tc.trim() !== "") return tc
  }

  const formatTags = result.format.tags
  if (formatTags) {
    if (formatTags.timecode) return formatTags.timecode

    const panasonic = formatTags["com.panasonic.Semi-Pro.metadata.xml"]
    if (panasonic) {
      const match = panasonic.match(/<StartTimecode>([^<]+)<\/StartTimecode>/)
      if (match) return match[1].trim()
    }
  }

  return null
}

function inferMediaKind(
  filePath: string,
  videoStream?: FFProbeStream,
  audioStream?: FFProbeStream,
): MediaKind {
  const inferredFromTarget = inferMediaKindFromTarget(filePath)

  if (inferredFromTarget === "image") return "image"
  if (videoStream) return "video"
  if (audioStream) return "audio"

  return inferredFromTarget
}

function parseDuration(durationValue: string | undefined, frameRate?: Rational): Rational | undefined {
  if (!durationValue) return undefined

  const durationSec = parseFloat(durationValue)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return undefined
  }

  if (frameRate) {
    const fps = frameRate.num / frameRate.den
    const totalFrames = Math.round(durationSec * fps)
    return rational(totalFrames * frameRate.den, frameRate.num)
  }

  return rational(Math.round(durationSec * 1000), 1000)
}

/**
 * Probe a media file and return an OTIO-first external media reference with
 * inferred media kind, stream info, and intrinsic available range when present.
 */
export async function probeMediaReference(filePath: string): Promise<ExternalReference> {
  const result = await ffprobe(filePath)

  const absolutePath = resolve(filePath)
  const videoStream = result.streams.find((stream) => stream.codec_type === "video")
  const audioStream = result.streams.find((stream) => stream.codec_type === "audio")
  const mediaKind = inferMediaKind(absolutePath, videoStream, audioStream)
  const frameRate = videoStream?.r_frame_rate
    ? parseFrameRate(videoStream.r_frame_rate)
    : undefined
  const duration = mediaKind === "image"
    ? undefined
    : parseDuration(result.format.duration, frameRate)

  const audioRate = audioStream?.sample_rate
    ? parseInt(audioStream.sample_rate, 10)
    : undefined
  const tcString = extractTimecodeString(result)
  const timecodeStart =
    tcString && frameRate
      ? parseTimecode(tcString, frameRate)
      : ZERO

  return {
    type: "external",
    name: basename(absolutePath),
    targetUrl: toFileUrl(absolutePath),
    mediaKind,
    availableRange: duration
      ? {
          startTime: timecodeStart,
          duration,
        }
      : undefined,
    streamInfo: {
      hasVideo: !!videoStream,
      hasAudio: !!audioStream,
      width: videoStream?.width,
      height: videoStream?.height,
      frameRate,
      audioRate,
      audioChannels: audioStream?.channels,
      colorSpace: videoStream ? detectColorSpace(videoStream) : undefined,
    },
  }
}
