# @chatoctopus/timeline

Import and export video editing timelines for Final Cut Pro, Adobe Premiere Pro, DaVinci Resolve, and OpenTimelineIO.

Generates well-formed FCPXML 1.8 (Final Cut Pro), FCP7 XML / xmeml v5 (Premiere, Resolve), and OTIO (OpenTimelineIO) with frame-accurate rational time math -- no floating-point drift.

Phase 3 checkpoint: the package now reads and writes OTIO directly against the OTIO-first core model and exposes core-native builder APIs: `probeMediaReference()`, `buildTimelineFromFiles()`, and `createTimeline()`. FCPXML and xmeml still use the temporary legacy bridge while the adapter migration continues.

## Installation

```bash
npm install @chatoctopus/timeline
```

Requires Node.js >= 18. For `buildTimelineFromFiles()` or `probeMediaReference()`, [FFmpeg/FFprobe](https://ffmpeg.org/) must be installed and on your PATH. Converting between formats does not require FFmpeg/FFprobe.

## CLI

The package ships with a `timeline` CLI focused on format conversion and validation:

```bash
npx @chatoctopus/timeline convert ./edit.fcpxml --to otio --out ./edit.otio
npx @chatoctopus/timeline validate ./edit.xml
npx @chatoctopus/timeline validate ./edit.otio --json
```

### Commands

| Command | Description |
| ------- | ----------- |
| `convert <input> --to <fcpx\|premiere\|resolve\|otio> [--out <path>]` | Auto-detect input format, convert to target editor format, and write to file (`--out`) or stdout |
| `validate <input> [--json]` | Validate timeline integrity and frame alignment; exits with non-zero on hard errors |

## Quick Start

### Import from an existing project file

Auto-detects FCPXML, xmeml, or OTIO format.

```ts
import { importTimeline, exportTimeline } from "@chatoctopus/timeline"
import { readFileSync, writeFileSync } from "fs"

// Read a Final Cut Pro project
const fcpxml = readFileSync("project.fcpxml", "utf-8")
const { timeline, warnings } = importTimeline(fcpxml)

console.log(`Imported "${timeline.name}" with ${timeline.tracks.length} tracks`)
if (warnings.length > 0) console.warn("Warnings:", warnings)

// Convert to Premiere Pro format
writeFileSync("project.xml", exportTimeline(timeline, "premiere"))
```

### Convert between formats

```ts
import { importTimeline, exportTimeline } from "@chatoctopus/timeline"
import { readFileSync, writeFileSync } from "fs"

// Premiere XML -> Final Cut Pro
const premiereXml = readFileSync("edit.xml", "utf-8")
const { timeline } = importTimeline(premiereXml)
writeFileSync("edit.fcpxml", exportTimeline(timeline, "fcpx"))

// Final Cut Pro -> DaVinci Resolve
const fcpxml = readFileSync("edit.fcpxml", "utf-8")
const { timeline: tl } = importTimeline(fcpxml)
writeFileSync("edit-resolve.xml", exportTimeline(tl, "resolve"))

// OTIO -> Final Cut Pro
const otio = readFileSync("project.otio", "utf-8")
const { timeline: tl2 } = importTimeline(otio)
writeFileSync("project.fcpxml", exportTimeline(tl2, "fcpx"))

// Any format -> OTIO
const anyFile = readFileSync("timeline.fcpxml", "utf-8")
const { timeline: tl3 } = importTimeline(anyFile)
writeFileSync("timeline.otio", exportTimeline(tl3, "otio"))
```

### Build a timeline from video files

The simplest path: provide file paths and optional trim points. Metadata is extracted automatically via FFprobe into inline `ExternalReference` objects.

`buildTimelineFromFiles()` validates trim inputs strictly: `startAt` and `duration` must be finite, non-negative numbers, `0` is treated as an explicit value, still images require an explicit `duration`, and mixed-frame-rate trims may be rejected when they cannot be represented consistently.

```ts
import { buildTimelineFromFiles, exportTimeline } from "@chatoctopus/timeline"
import { writeFileSync } from "fs"

const timeline = await buildTimelineFromFiles("Wedding Highlights", [
  { path: "/footage/ceremony.mp4", startAt: 30, duration: 10 },
  { path: "/footage/reception.mp4", duration: 15 },
  { path: "/footage/speeches.mp4", startAt: 120, duration: 20 },
  { path: "/slides/title-card.png", duration: 3 },
])

// Final Cut Pro
writeFileSync("wedding.fcpxml", exportTimeline(timeline, "fcpx"))

// Adobe Premiere Pro
writeFileSync("wedding.xml", exportTimeline(timeline, "premiere"))

// DaVinci Resolve
writeFileSync("wedding.xml", exportTimeline(timeline, "resolve"))

// OpenTimelineIO (universal interchange)
writeFileSync("wedding.otio", exportTimeline(timeline, "otio"))
```

### Construct a timeline manually

For full control, build the OTIO-first `Timeline` model directly. All timing uses `Rational` numbers (`{ num, den }`) to stay frame-aligned.

```ts
import {
  exportTimeline,
  rational,
  ZERO,
  FRAME_RATES,
} from "@chatoctopus/timeline"
import type { Timeline } from "@chatoctopus/timeline"
import { writeFileSync } from "fs"

const timeline: Timeline = {
  name: "My Edit",
  format: {
    width: 1920,
    height: 1080,
    frameRate: FRAME_RATES["29.97"], // { num: 30000, den: 1001 }
    audioRate: 48000,
    colorSpace: "1-1-1 (Rec. 709)",
  },
  tracks: [
    {
      kind: "video",
      name: "V1",
      items: [
        {
          kind: "clip",
          name: "interview",
          mediaReference: {
            type: "external",
            name: "interview.mp4",
            targetUrl: "file:///footage/interview.mp4",
            mediaKind: "video",
            availableRange: {
              startTime: ZERO,
              duration: rational(9000 * 1001, 30000), // 9000 frames at 29.97fps
            },
          },
          sourceRange: {
            startTime: rational(300 * 1001, 30000), // start from frame 300 in source
            duration: rational(150 * 1001, 30000), // 150 frames = ~5 seconds
          },
          metadata: {
            role: "dialogue",
          },
        },
      ],
    },
  ],
}

writeFileSync("output.otio", exportTimeline(timeline, "otio"))
writeFileSync("output.fcpxml", exportTimeline(timeline, "fcpx"))
```

`Timeline` is the preferred API for new OTIO-driven work. `NLETimeline` still exists temporarily so the older FCPXML/xmeml builders and readers can keep working during the migration.

## API Reference

### High-Level Functions

| Function                                     | Description                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `exportTimeline(timeline, editor, options?)` | Export a `Timeline` or `NLETimeline`. `editor` is `"fcpx"`, `"premiere"`, `"resolve"`, or `"otio"`. |
| `importTimeline(content)`                    | Parse FCPXML, xmeml, or OTIO. OTIO currently imports into `Timeline`; FCPXML/xmeml still import into `NLETimeline` during migration. |
| `buildTimelineFromFiles(name, files)`        | Probe files with FFprobe and build a linear `Timeline` with inline media references. |
| `createTimeline(options)`                    | Create a `Timeline` with default format values for synthetic or programmatic edits. |

### Format-Specific Functions

| Function                          | Description                        |
| --------------------------------- | ---------------------------------- |
| `writeFCPXML(timeline, options?)` | Generate FCPXML 1.8 string |
| `readFCPXML(xmlString)`           | Parse FCPXML into `NLETimeline` |
| `writeXMEML(timeline, options?)`  | Generate xmeml v5 string |
| `readXMEML(xmlString)`            | Parse xmeml into `NLETimeline` |
| `writeOTIO(timeline)`             | Generate OTIO JSON from `Timeline` or `NLETimeline` |
| `readOTIO(jsonString)`            | Parse OTIO JSON into `Timeline` |

### Time Utilities

All timing uses `Rational` (`{ num: number, den: number }`) to avoid floating-point drift.

| Function                                 | Description                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `rational(num, den)`                     | Create a simplified rational number                                              |
| `add(a, b)`                              | Add two rationals                                                                |
| `subtract(a, b)`                         | Subtract (clamps to zero)                                                        |
| `toSeconds(r)`                           | Convert rational to float seconds                                                |
| `toFCPString(r)`                         | Format as FCP time string (`"1001/24000s"`)                                      |
| `parseFCPString(s)`                      | Parse FCP time string back to rational                                           |
| `secondsToFrameAligned(secs, frameRate)` | Convert seconds, snapped to nearest frame boundary                               |
| `toFrames(duration, frameDuration)`      | Convert rational to frame count                                                  |
| `parseTimecode(tc, frameRate)`           | Parse SMPTE timecode (`"01:00:00;00"`) with drop-frame support                   |
| `FRAME_RATES`                            | Common presets: `"23.976"`, `"24"`, `"25"`, `"29.97"`, `"30"`, `"59.94"`, `"60"` |

### Validation

| Function                            | Description                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `validateTimeline(timeline)`        | Returns array of `ValidationError` (checks asset refs, frame alignment, dimensions) |
| `hasErrors(results)`                | `true` if any hard errors (not just warnings)                                       |
| `computeTimelineDuration(timeline)` | Compute total duration from all track clips                                         |

### Probing

| Function               | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `probeMediaReference(filePath)` | Run FFprobe on a file and return a populated `ExternalReference` |

## Types

```ts
interface Timeline {
  name: string
  format: NLEFormat
  tracks: Track[]
  metadata?: Record<string, unknown>
  markers?: Marker[]
  globalStartTime?: Rational
}

interface NLEFormat {
  width: number
  height: number
  frameRate: Rational // e.g. { num: 30000, den: 1001 } for 29.97fps
  audioRate: number // e.g. 48000
  colorSpace?: string
}

type TrackItem = Clip | Gap | Transition

interface Track {
  kind: "video" | "audio"
  name?: string
  items: TrackItem[]
  metadata?: Record<string, unknown>
  markers?: Marker[]
  enabled?: boolean
}

interface Clip {
  kind: "clip"
  name: string
  mediaReference: MediaReference
  sourceRange?: TimeRange
  metadata?: Record<string, unknown>
  markers?: Marker[]
  enabled?: boolean
}

interface Gap {
  kind: "gap"
  sourceRange: TimeRange
  metadata?: Record<string, unknown>
  enabled?: boolean
}

interface Transition {
  kind: "transition"
  name?: string
  transitionType?: string
  inOffset: Rational
  outOffset: Rational
  metadata?: Record<string, unknown>
}

interface TimeRange {
  startTime: Rational
  duration: Rational
}

type MediaReference = ExternalReference | MissingReference

interface ExternalReference {
  type: "external"
  targetUrl: string
  name?: string
  mediaKind?: "video" | "audio" | "image" | "unknown"
  availableRange?: TimeRange
  metadata?: Record<string, unknown>
  streamInfo?: StreamInfo
}

interface MissingReference {
  type: "missing"
  name?: string
  metadata?: Record<string, unknown>
}

interface StreamInfo {
  hasVideo?: boolean
  hasAudio?: boolean
  width?: number
  height?: number
  frameRate?: Rational
  audioRate?: number
  audioChannels?: number
  colorSpace?: string
}

type NLEEditor = "fcpx" | "premiere" | "resolve" | "otio"
```

Legacy note: `NLETimeline`, `NLETrack`, `NLEClip`, and `NLEAsset` still exist temporarily while the FCPXML/xmeml adapters are migrated to the new core model. Treat them as transitional, not the long-term API.

Builder inputs:

```ts
interface TimelineFileInput {
  path: string
  startAt?: number
  duration?: number
  track?: number
  kind?: "video" | "audio"
}

interface CreateTimelineOptions {
  name: string
  format?: Partial<NLEFormat>
  tracks?: Track[]
  metadata?: Record<string, unknown>
  markers?: Marker[]
  globalStartTime?: Rational
}
```

## Supported Formats

| Format         | Extension | Editors / Tools                            | Read | Write |
| -------------- | --------- | ------------------------------------------ | ---- | ----- |
| FCPXML 1.8     | `.fcpxml` | Final Cut Pro                              | Yes  | Yes   |
| xmeml v5       | `.xml`    | Adobe Premiere Pro, DaVinci Resolve        | Yes  | Yes   |
| OpenTimelineIO | `.otio`   | Resolve 18+, Hiero, rv, and OTIO ecosystem | Yes  | Yes   |

## Verification

Run the test suite:

```bash
npm test
```

Run tests with coverage:

```bash
npm run test:coverage
```

Type-check without emitting:

```bash
npm run lint
```

Build:

```bash
npm run build
```

### Quick smoke test

```bash
node --input-type=module -e "
import { exportTimeline, rational, ZERO, FRAME_RATES } from './dist/index.js';

const timeline = {
  name: 'Smoke Test',
  format: {
    width: 1920, height: 1080,
    frameRate: FRAME_RATES['29.97'],
    audioRate: 48000,
  },
  tracks: [{
    kind: 'video',
    items: [{
      kind: 'clip',
      name: 'clip',
      mediaReference: {
        type: 'external',
        name: 'clip.mp4',
        targetUrl: 'file:///tmp/clip.mp4',
        mediaKind: 'video',
        availableRange: {
          startTime: ZERO,
          duration: rational(300 * 1001, 30000),
        },
      },
      sourceRange: {
        startTime: ZERO,
        duration: rational(150 * 1001, 30000),
      },
    }],
  }],
};

const fcpxml = exportTimeline(timeline, 'fcpx');
const xmeml = exportTimeline(timeline, 'premiere');
const otio = exportTimeline(timeline, 'otio');

console.log('FCPXML:', fcpxml.includes('<fcpxml') ? 'OK' : 'FAIL');
console.log('xmeml:', xmeml.includes('<xmeml') ? 'OK' : 'FAIL');
console.log('OTIO:', otio.includes('Timeline.1') ? 'OK' : 'FAIL');
console.log('Done.');
"
```

## Architecture

```
src/
├── index.ts           Public API: exportTimeline, importTimeline, createTimeline, buildTimelineFromFiles
├── types.ts           OTIO-first core types plus temporary legacy bridge types
├── time.ts            Rational arithmetic, frame alignment, SMPTE timecode parsing
├── probe.ts           FFprobe -> ExternalReference probing
├── builders.ts        Core-native timeline construction helpers
├── validate.ts        Core + legacy validation and duration computation
├── core-legacy.ts     Temporary bridge between the core model and legacy adapters
├── fcpxml/
│   ├── writer.ts      FCPXML 1.8 generation
│   └── reader.ts      FCPXML parsing
├── xmeml/
│   ├── writer.ts      xmeml v5 generation (Premiere / Resolve)
│   └── reader.ts      xmeml parsing
└── otio/
    ├── writer.ts      OpenTimelineIO JSON generation
    └── reader.ts      OpenTimelineIO JSON parsing
```

## How It Works

**Rational time math** is the core of the library. All NLE software uses frame-aligned timing internally -- expressing durations as rational fractions like `1001/30000s` (one frame at 29.97fps). Using floating-point seconds causes frame drift and "not on edit frame boundary" errors in Final Cut Pro.

Every clip duration and offset goes through `secondsToFrameAligned()` which snaps to the nearest frame boundary, matching the behavior of both [buttercut](https://github.com/barefootford/buttercut) (Ruby) and [cutlass](https://github.com/andrewarrow/cutlass) (Go) which this library draws from.

**Three interchange formats** cover all major editors and tools:

- **FCPXML 1.8** for Final Cut Pro -- trackless magnetic timeline with `<asset-clip>` elements inside a `<spine>`
- **xmeml v5** for Premiere and Resolve -- track-based with linked `<clipitem>` elements for video and audio
- **OpenTimelineIO** (`.otio`) -- the industry-standard JSON interchange format backed by the Academy Software Foundation. OTIO acts as a universal hub: any tool that speaks OTIO gets instant access to timelines from any other format. In this package, OTIO now maps directly to the core model, including explicit gaps, transitions, markers, metadata, and inline media references.

## Acknowledgments

This project draws on ideas and timing behavior from [`buttercut`](https://github.com/barefootford/buttercut) and [`cutlass`](https://github.com/andrewarrow/cutlass), and we gratefully acknowledge those projects as upstream inspiration.

## Trademarks

Final Cut Pro is a trademark of Apple Inc. Adobe Premiere Pro is a trademark of Adobe. DaVinci Resolve is a trademark of Blackmagic Design Pty Ltd. All other product names, logos, and brands are the property of their respective owners.

## License

MIT
