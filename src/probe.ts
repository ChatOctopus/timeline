import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { NLEAsset, NLEFormat, Rational } from "./types.js"
import { rational, ZERO, parseTimecode } from "./time.js"
import { createHash } from "node:crypto"

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

function deterministicId(absPath: string): string {
  return "r" + createHash("md5").update(absPath).digest("hex").slice(0, 12)
}

function deterministicUid(absPath: string): string {
  const hex = createHash("md5").update(absPath).digest("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

/**
 * Probe a media file and return an NLEAsset with all metadata populated.
 */
export async function probeAsset(filePath: string): Promise<NLEAsset> {
  const result = await ffprobe(filePath)

  const videoStream = result.streams.find((s) => s.codec_type === "video")
  const audioStream = result.streams.find((s) => s.codec_type === "audio")

  const frameRate = videoStream?.r_frame_rate
    ? parseFrameRate(videoStream.r_frame_rate)
    : rational(24, 1)

  const durationSec = result.format.duration
    ? parseFloat(result.format.duration)
    : 0

  const fps = frameRate.num / frameRate.den
  const totalFrames = Math.round(durationSec * fps)
  const duration = rational(totalFrames * frameRate.den, frameRate.num)

  const audioRate = audioStream?.sample_rate
    ? parseInt(audioStream.sample_rate, 10)
    : undefined

  const tcString = extractTimecodeString(result)
  const timecodeStart = tcString ? parseTimecode(tcString, frameRate) : ZERO

  const videoFormat: NLEFormat | undefined = videoStream
    ? {
        width: videoStream.width ?? 1920,
        height: videoStream.height ?? 1080,
        frameRate,
        audioRate: audioRate ?? 48000,
        colorSpace: detectColorSpace(videoStream),
      }
    : undefined

  const absPath = filePath.startsWith("/")
    ? filePath
    : `${process.cwd()}/${filePath}`

  return {
    id: deterministicId(absPath),
    name: filePath.split("/").pop() ?? filePath,
    path: absPath,
    duration,
    hasVideo: !!videoStream,
    hasAudio: !!audioStream,
    videoFormat,
    audioChannels: audioStream?.channels,
    audioRate,
    timecodeStart,
  }
}
