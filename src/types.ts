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

export type Metadata = Record<string, unknown>

export interface TimeRange {
  startTime: Rational
  duration: Rational
}

export type MediaKind = "video" | "audio" | "image" | "unknown"

export interface StreamInfo {
  hasVideo?: boolean
  hasAudio?: boolean
  width?: number
  height?: number
  frameRate?: Rational
  audioRate?: number
  audioChannels?: number
  colorSpace?: string
}

export interface ExternalReference {
  type: "external"
  targetUrl: string
  name?: string
  mediaKind?: MediaKind
  availableRange?: TimeRange
  metadata?: Metadata
  streamInfo?: StreamInfo
}

export interface MissingReference {
  type: "missing"
  name?: string
  metadata?: Metadata
}

export type MediaReference = ExternalReference | MissingReference

export interface Marker {
  name?: string
  color?: string | null
  metadata?: Metadata
  markedRange?: TimeRange
}

export interface Clip {
  kind: "clip"
  name: string
  mediaReference: MediaReference
  sourceRange?: TimeRange
  metadata?: Metadata
  markers?: Marker[]
  enabled?: boolean
}

export interface Gap {
  kind: "gap"
  sourceRange: TimeRange
  metadata?: Metadata
  enabled?: boolean
}

export interface Transition {
  kind: "transition"
  name?: string
  transitionType?: string
  inOffset: Rational
  outOffset: Rational
  metadata?: Metadata
}

export type TrackItem = Clip | Gap | Transition

export interface Track {
  kind: "video" | "audio"
  name?: string
  items: TrackItem[]
  metadata?: Metadata
  markers?: Marker[]
  enabled?: boolean
}

export interface Timeline {
  name: string
  format: NLEFormat
  tracks: Track[]
  metadata?: Metadata
  markers?: Marker[]
  globalStartTime?: Rational
}

/**
 * Legacy adapter-facing types. These remain in place temporarily while the
 * format adapters are migrated to the OTIO-first core model.
 */
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
  timeline: Timeline | NLETimeline
  /** Warnings encountered during parsing (non-fatal issues) */
  warnings: string[]
}
