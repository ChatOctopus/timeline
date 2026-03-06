/**
 * Rational number for frame-accurate time representation.
 * All NLE timing uses rational fractions to avoid floating-point drift.
 * FCP format: "240240/24000s", xmeml format: frame counts.
 */
export interface Rational {
  num: number
  den: number
}

export type NLEEditor = "fcpx" | "premiere" | "resolve" | "otio"

export type NLEExportFormat = "fcpxml" | "xmeml" | "otio"

export interface NLEFormat {
  width: number
  height: number
  frameRate: Rational
  audioRate: number
  colorSpace?: string
}

export interface NLEAsset {
  id: string
  name: string
  path: string
  duration: Rational
  hasVideo: boolean
  hasAudio: boolean
  videoFormat?: NLEFormat
  audioChannels?: number
  audioRate?: number
  timecodeStart?: Rational
}

export interface NLEClip {
  assetId: string
  name: string
  offset: Rational
  duration: Rational
  sourceIn: Rational
  sourceDuration: Rational
  lane?: number
  audioRole?: string
  volume?: number
  enabled?: boolean
}

export interface NLETrack {
  type: "video" | "audio"
  clips: NLEClip[]
}

export interface NLETimeline {
  name: string
  format: NLEFormat
  tracks: NLETrack[]
  assets: NLEAsset[]
}

/**
 * Simplified input for building a timeline from a list of clips.
 * Offsets are computed automatically by sequencing clips in order within each track.
 */
export interface ClipInput {
  path: string
  startAt?: number
  duration?: number
  /** Track index (0-based). Clips with the same track are sequenced together. Default: 0 */
  track?: number
  /** Track type. Default: inferred from media (video if has video, else audio) */
  type?: "video" | "audio"
}

export interface ExportOptions {
  format: NLEExportFormat
  /** Volume adjustment in dB (default: 0) */
  volumeDb?: number
}

export interface ImportResult {
  timeline: NLETimeline
  /** Warnings encountered during parsing (non-fatal issues) */
  warnings: string[]
}
