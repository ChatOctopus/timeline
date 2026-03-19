export type {
  Rational,
  Metadata,
  TimeRange,
  MediaKind,
  StreamInfo,
  ExternalReference,
  MissingReference,
  MediaReference,
  Marker,
  Clip,
  Gap,
  Transition,
  TrackItem,
  Track,
  Timeline,
  NLETimeline,
  NLETrack,
  NLEClip,
  NLEAsset,
  NLEFormat,
  NLEEditor,
  NLEExportFormat,
  TimelineFileInput,
  CreateTimelineOptions,
  ExportOptions,
  ImportResult,
} from "./types.js"

export {
  rational,
  ZERO,
  add,
  subtract,
  subtractUnclamped,
  multiply,
  divide,
  toSeconds,
  toFCPString,
  parseFCPString,
  frameDuration,
  secondsToFrameAligned,
  roundToFrameBoundary,
  toFrames,
  nominalFrameRate,
  isNTSC,
  isDropFrame,
  parseTimecode,
  FRAME_RATES,
} from "./time.js"

export { probeMediaReference } from "./probe.js"
export { createTimeline, buildTimelineFromFiles } from "./builders.js"

export {
  validateTimeline,
  hasErrors,
  computeTimelineDuration,
} from "./validate.js"
export type { ValidationError } from "./validate.js"

export { writeFCPXML } from "./fcpxml/writer.js"
export { readFCPXML } from "./fcpxml/reader.js"
export { writeXMEML } from "./xmeml/writer.js"
export { readXMEML } from "./xmeml/reader.js"
export { writeOTIO } from "./otio/writer.js"
export { readOTIO } from "./otio/reader.js"

import type {
  Timeline,
  NLETimeline,
  NLEEditor,
  NLEExportFormat,
  ExportOptions,
  ImportResult,
} from "./types.js"
import { writeFCPXML } from "./fcpxml/writer.js"
import { readFCPXML } from "./fcpxml/reader.js"
import { writeXMEML } from "./xmeml/writer.js"
import { readXMEML } from "./xmeml/reader.js"
import { writeOTIO } from "./otio/writer.js"
import { readOTIO } from "./otio/reader.js"
import { coreToLegacyTimeline, isLegacyTimeline } from "./core-legacy.js"

const EDITOR_FORMAT_MAP: Record<NLEEditor, NLEExportFormat> = {
  fcpx: "fcpxml",
  premiere: "xmeml",
  resolve: "xmeml",
  otio: "otio",
}

/**
 * Export a timeline to the specified NLE format.
 *
 * @param timeline - The timeline to export
 * @param editor - Target editor ("fcpx", "premiere", "resolve", or "otio")
 * @param options - Additional export options
 * @returns XML or JSON string ready to be written to a file
 */
export function exportTimeline(
  timeline: Timeline | NLETimeline,
  editor: NLEEditor,
  options?: Omit<ExportOptions, "format">,
): string {
  const format = EDITOR_FORMAT_MAP[editor]
  const fullOptions: ExportOptions = { ...options, format }
  const legacyTimeline = isLegacyTimeline(timeline) ? timeline : coreToLegacyTimeline(timeline)

  switch (format) {
    case "fcpxml":
      return writeFCPXML(legacyTimeline, fullOptions)
    case "xmeml":
      return writeXMEML(legacyTimeline, fullOptions)
    case "otio":
      return writeOTIO(timeline)
    default:
      throw new Error(`Unsupported format: ${format}`)
  }
}

/**
 * Import a timeline from an XML or OTIO JSON string.
 * Auto-detects FCPXML, xmeml, or OTIO based on content.
 *
 * @param content - The file content to parse (XML or JSON)
 * @returns Parsed timeline and any warnings
 */
export function importTimeline(content: string): ImportResult {
  const trimmed = content.trim()

  if (trimmed.includes("<fcpxml") || trimmed.includes("<!DOCTYPE fcpxml")) {
    return readFCPXML(content)
  }

  if (trimmed.includes("<xmeml") || trimmed.includes("<!DOCTYPE xmeml")) {
    return readXMEML(content)
  }

  if (trimmed.startsWith("{") && trimmed.includes("OTIO_SCHEMA")) {
    return readOTIO(content)
  }

  throw new Error(
    "Unrecognized format. Expected FCPXML (<fcpxml>), xmeml (<xmeml>), or OTIO (JSON with OTIO_SCHEMA).",
  )
}
