import { describe, it, expect } from "vitest"
import { writeFCPXML } from "../src/fcpxml/writer.js"
import { writeXMEML } from "../src/xmeml/writer.js"
import { writeOTIO } from "../src/otio/writer.js"
import type { ExternalReference, Timeline } from "../src/types.js"
import { rational, ZERO } from "../src/time.js"

const FRAME_RATE = rational(30000, 1001)

function frames(frameCount: number) {
  return rational(frameCount * 1001, 30000)
}

function makeReference(
  name: string,
  targetUrl: string,
  duration: ReturnType<typeof frames>,
  options?: {
    mediaKind?: "video" | "audio" | "image"
    hasAudio?: boolean
  },
): ExternalReference {
  const mediaKind = options?.mediaKind ?? "video"
  const hasVideo = mediaKind !== "audio"
  const hasAudio = options?.hasAudio ?? mediaKind !== "image"

  return {
    type: "external",
    name,
    targetUrl,
    mediaKind,
    availableRange: {
      startTime: ZERO,
      duration,
    },
    streamInfo: {
      hasVideo,
      hasAudio,
      width: 1920,
      height: 1080,
      frameRate: FRAME_RATE,
      audioRate: 48000,
      audioChannels: hasAudio ? 2 : undefined,
    },
  }
}

function makeClip(
  name: string,
  mediaReference: ExternalReference,
  duration: ReturnType<typeof frames>,
) {
  return {
    kind: "clip" as const,
    name,
    mediaReference,
    sourceRange: {
      startTime: ZERO,
      duration,
    },
  }
}

function makeTimeline(name: string, tracks: Timeline["tracks"]): Timeline {
  return {
    name,
    format: {
      width: 1920,
      height: 1080,
      frameRate: FRAME_RATE,
      audioRate: 48000,
    },
    tracks,
  }
}

describe("known gaps: fcpxml export", () => {
  it("keeps connected clips even when they start in a timeline gap", () => {
    const mainRef = makeReference("main.mov", "/media/main.mov", frames(600))
    const overlayRef = makeReference("overlay.mov", "/media/overlay.mov", frames(600))
    const timeline = makeTimeline("Connected Gap Coverage", [
      {
        kind: "video",
        items: [makeClip("main", mainRef, frames(150))],
      },
      {
        kind: "video",
        items: [
          {
            kind: "gap",
            sourceRange: {
              startTime: ZERO,
              duration: frames(210),
            },
          },
          makeClip("LATE_OVERLAY_SENTINEL", overlayRef, frames(60)),
        ],
      },
    ])

    const xml = writeFCPXML(timeline)
    expect(xml).toContain('name="LATE_OVERLAY_SENTINEL"')
  })

  it("percent-encodes reserved characters in asset file URLs", () => {
    const timeline = makeTimeline("FCPXML URL Encoding", [
      {
        kind: "video",
        items: [
          makeClip(
            "url-test",
            makeReference(
              "shot #1?.mov",
              "/Volumes/Media Drive/shot #1?.mov",
              frames(300),
            ),
            frames(120),
          ),
        ],
      },
    ])

    const xml = writeFCPXML(timeline)
    expect(xml).toContain(
      'src="file:///Volumes/Media%20Drive/shot%20%231%3F.mov"',
    )
  })
})

describe("known gaps: xmeml export", () => {
  it("exports clipitems for explicit audio tracks even when no video tracks exist", () => {
    const timeline = makeTimeline("Audio Only XMEML", [
      {
        kind: "audio",
        items: [
          makeClip(
            "AUDIO_TRACK_SENTINEL",
            makeReference("music.wav", "/audio/music.wav", frames(600), {
              mediaKind: "audio",
            }),
            frames(120),
          ),
        ],
      },
    ])

    const xml = writeXMEML(timeline)
    expect(xml).toContain("AUDIO_TRACK_SENTINEL")
  })

  it("preserves source track indexes for secondary video tracks", () => {
    const timeline = makeTimeline("Track Index Coverage", [
      {
        kind: "video",
        items: [makeClip("v1", makeReference("v1.mov", "/video/v1.mov", frames(600)), frames(120))],
      },
      {
        kind: "video",
        items: [makeClip("v2", makeReference("v2.mov", "/video/v2.mov", frames(600)), frames(120))],
      },
    ])

    const xml = writeXMEML(timeline)
    expect(xml).toContain("<trackindex>2</trackindex>")
  })

  it("percent-encodes reserved characters in pathurl", () => {
    const timeline = makeTimeline("XMEML URL Encoding", [
      {
        kind: "video",
        items: [
          makeClip(
            "url-test",
            makeReference(
              "shot #1?.mov",
              "/Volumes/Media Drive/shot #1?.mov",
              frames(300),
            ),
            frames(120),
          ),
        ],
      },
    ])

    const xml = writeXMEML(timeline)
    expect(xml).toContain(
      "<pathurl>file:///Volumes/Media%20Drive/shot%20%231%3F.mov</pathurl>",
    )
  })
})

describe("known gaps: otio export", () => {
  it("percent-encodes target_url paths in media references", () => {
    const timeline = makeTimeline("OTIO URL Encoding", [
      {
        kind: "video",
        items: [
          makeClip(
            "url-test",
            makeReference(
              "shot 01.mov",
              "/Volumes/Media Drive/shot 01.mov",
              frames(300),
            ),
            frames(120),
          ),
        ],
      },
    ])

    const otio = JSON.parse(writeOTIO(timeline))
    const targetUrl =
      otio.tracks.children[0].children[0].media_references.DEFAULT_MEDIA
        .target_url

    expect(targetUrl).toBe("file:///Volumes/Media%20Drive/shot%2001.mov")
  })

  it("percent-encodes reserved characters in target_url", () => {
    const timeline = makeTimeline("OTIO Reserved URL Encoding", [
      {
        kind: "video",
        items: [
          makeClip(
            "url-test",
            makeReference(
              "shot #1?.mov",
              "/Volumes/Media Drive/shot #1?.mov",
              frames(300),
            ),
            frames(120),
          ),
        ],
      },
    ])

    const otio = JSON.parse(writeOTIO(timeline))
    const targetUrl =
      otio.tracks.children[0].children[0].media_references.DEFAULT_MEDIA
        .target_url

    expect(targetUrl).toBe("file:///Volumes/Media%20Drive/shot%20%231%3F.mov")
  })
})
