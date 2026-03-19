import { describe, expect, it } from "vitest"
import { rational, ZERO } from "../src/time.js"
import { readOTIO } from "../src/otio/reader.js"
import { writeOTIO } from "../src/otio/writer.js"
import type { Timeline } from "../src/types.js"

function makeTimeline(): Timeline {
  return {
    name: "OTIO Core",
    format: {
      width: 1080,
      height: 1920,
      frameRate: rational(30, 1),
      audioRate: 48000,
      colorSpace: "1-1-1 (Rec. 709)",
    },
    globalStartTime: rational(30, 30),
    metadata: {
      app: { projectId: "proj-1" },
    },
    markers: [
      {
        name: "timeline-marker",
        color: "RED",
        metadata: { section: "intro" },
        markedRange: {
          startTime: ZERO,
          duration: rational(15, 30),
        },
      },
    ],
    tracks: [
      {
        kind: "video",
        name: "V1",
        metadata: { layer: 1 },
        items: [
          {
            kind: "clip",
            name: "image-clip",
            metadata: { role: "hero" },
            markers: [
              {
                name: "clip-marker",
                metadata: { emphasis: true },
                markedRange: {
                  startTime: ZERO,
                  duration: rational(10, 30),
                },
              },
            ],
            mediaReference: {
              type: "external",
              name: "slide.png",
              targetUrl: "file:///slides/slide.png",
              mediaKind: "image",
              availableRange: {
                startTime: ZERO,
                duration: rational(150, 30),
              },
              metadata: {
                source: "generated",
              },
            },
            sourceRange: {
              startTime: ZERO,
              duration: rational(90, 30),
            },
          },
          {
            kind: "gap",
            metadata: { reason: "beat" },
            sourceRange: {
              startTime: ZERO,
              duration: rational(30, 30),
            },
          },
          {
            kind: "transition",
            name: "cross-dissolve",
            transitionType: "SMPTE_Dissolve",
            inOffset: rational(12, 30),
            outOffset: rational(12, 30),
            metadata: { preset: "soft" },
          },
          {
            kind: "clip",
            name: "video-clip",
            mediaReference: {
              type: "external",
              name: "clip.mp4",
              targetUrl: "file:///video/clip.mp4",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(300, 30),
              },
              metadata: {
                streamLabel: "main",
              },
              streamInfo: {
                hasVideo: true,
                hasAudio: true,
                width: 1920,
                height: 1080,
                frameRate: rational(30, 1),
                audioRate: 48000,
                audioChannels: 2,
              },
            },
            sourceRange: {
              startTime: rational(30, 30),
              duration: rational(120, 30),
            },
            enabled: false,
          },
        ],
      },
    ],
  }
}

describe("OTIO-first adapter", () => {
  it("writes metadata, markers, transitions, gaps, and global start time from the core model", () => {
    const json = writeOTIO(makeTimeline() as any)
    const parsed = JSON.parse(json)

    expect(parsed.global_start_time.value).toBe(30)
    expect(parsed.metadata.app.projectId).toBe("proj-1")
    expect(parsed.metadata["@chatoctopus/timeline"].format.width).toBe(1080)
    expect(parsed.tracks.markers[0].name).toBe("timeline-marker")

    const track = parsed.tracks.children[0]
    expect(track.metadata.layer).toBe(1)
    expect(track.children.map((item: any) => item.OTIO_SCHEMA)).toEqual([
      "Clip.2",
      "Gap.1",
      "Transition.1",
      "Clip.2",
    ])

    const imageClip = track.children[0]
    expect(imageClip.metadata.role).toBe("hero")
    expect(imageClip.markers[0].name).toBe("clip-marker")
    expect(imageClip.media_references.DEFAULT_MEDIA.metadata.source).toBe("generated")
    expect(imageClip.media_references.DEFAULT_MEDIA.metadata["@chatoctopus/timeline"].mediaKind).toBe("image")
  })

  it("reads OTIO into the new core model with explicit track items", () => {
    const json = writeOTIO(makeTimeline() as any)
    const { timeline, warnings } = readOTIO(json)

    expect(warnings).toEqual([])
    expect(timeline.globalStartTime).toEqual(rational(30, 30))
    expect(timeline.metadata?.app).toEqual({ projectId: "proj-1" })
    expect(timeline.markers?.[0]?.name).toBe("timeline-marker")
    expect(timeline.tracks[0]?.items.map((item) => item.kind)).toEqual([
      "clip",
      "gap",
      "transition",
      "clip",
    ])

    const imageClip = timeline.tracks[0]?.items[0]
    expect(imageClip?.kind).toBe("clip")
    if (imageClip?.kind !== "clip") throw new Error("expected clip")
    expect(imageClip.mediaReference.type).toBe("external")
    if (imageClip.mediaReference.type !== "external") throw new Error("expected external ref")
    expect(imageClip.mediaReference.mediaKind).toBe("image")
    expect(imageClip.mediaReference.metadata).toEqual({ source: "generated" })
    expect(imageClip.markers?.[0]?.name).toBe("clip-marker")
  })

  it("preserves stream info on external references through OTIO metadata", () => {
    const json = writeOTIO(makeTimeline() as any)
    const { timeline } = readOTIO(json)

    const videoClip = timeline.tracks[0]?.items[3]
    expect(videoClip?.kind).toBe("clip")
    if (videoClip?.kind !== "clip") throw new Error("expected clip")
    expect(videoClip.mediaReference.type).toBe("external")
    if (videoClip.mediaReference.type !== "external") throw new Error("expected external ref")
    expect(videoClip.mediaReference.streamInfo).toMatchObject({
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
      audioRate: 48000,
      audioChannels: 2,
    })
  })
})
