import { describe, it, expect } from "vitest"
import { writeXMEML } from "../src/xmeml/writer.js"
import { readXMEML } from "../src/xmeml/reader.js"
import type { Timeline, TrackItem } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    name: "Test Sequence",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(30000, 1001),
      audioRate: 48000,
      audioChannels: 2,
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
                duration: rational(900 * 1001, 30000),
              },
              streamInfo: {
                hasVideo: true,
                hasAudio: true,
                width: 1920,
                height: 1080,
                frameRate: rational(30000, 1001),
                audioRate: 48000,
                audioChannels: 2,
              },
            },
            sourceRange: {
              startTime: ZERO,
              duration: rational(300 * 1001, 30000),
            },
          },
          {
            kind: "gap",
            sourceRange: {
              startTime: ZERO,
              duration: rational(15 * 1001, 30000),
            },
          },
          {
            kind: "clip",
            name: "broll",
            mediaReference: {
              type: "external",
              name: "broll.mp4",
              targetUrl: "file:///footage/broll.mp4",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(450 * 1001, 30000),
              },
              streamInfo: {
                hasVideo: true,
                hasAudio: true,
                width: 1920,
                height: 1080,
                frameRate: rational(24000, 1001),
                audioRate: 48000,
                audioChannels: 2,
              },
            },
            sourceRange: {
              startTime: rational(30 * 1001, 24000),
              duration: rational(150 * 1001, 30000),
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

function expectClip(item: TrackItem) {
  expect(item.kind).toBe("clip")
  if (item.kind !== "clip") {
    throw new Error("expected clip")
  }

  return item
}

describe("writeXMEML", () => {
  it("generates valid xmeml v5 structure from the core model", () => {
    const xml = writeXMEML(makeTimeline())

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain("<!DOCTYPE xmeml>")
    expect(xml).toContain('<xmeml version="5">')
    expect(xml).toContain("<sequence")
    expect(xml).toContain("<media>")
    expect(xml).toContain("<video>")
    expect(xml).toContain("<audio>")
  })

  it("includes correct timebase and NTSC flag", () => {
    const xml = writeXMEML(makeTimeline())
    expect(xml).toContain("<timebase>30</timebase>")
    expect(xml).toContain("<ntsc>TRUE</ntsc>")
  })

  it("uses the sequence audio channel count from the format", () => {
    const xml = writeXMEML(
      makeTimeline({
        format: {
          width: 1920,
          height: 1080,
          frameRate: rational(30000, 1001),
          audioRate: 48000,
          audioChannels: 1,
        },
      }),
    )

    expect(xml).toContain("<numOutputChannels>1</numOutputChannels>")
  })

  it("generates PAL timebase for 25fps", () => {
    const xml = writeXMEML(
      makeTimeline({
        format: {
          width: 1920,
          height: 1080,
          frameRate: rational(25, 1),
          audioRate: 48000,
        },
      }),
    )
    expect(xml).toContain("<timebase>25</timebase>")
    expect(xml).toContain("<ntsc>FALSE</ntsc>")
  })

  it("creates linked video and audio clipitems", () => {
    const xml = writeXMEML(makeTimeline())
    expect(xml).toContain("clipitem-video-1")
    expect(xml).toContain("clipitem-audio-1")
    expect(xml).toContain("<linkclipref>clipitem-video-1</linkclipref>")
    expect(xml).toContain("<linkclipref>clipitem-audio-1</linkclipref>")
  })

  it("includes file elements with pathurl", () => {
    const xml = writeXMEML(makeTimeline())
    expect(xml).toContain("<pathurl>file:///footage/interview.mp4</pathurl>")
    expect(xml).toContain("<pathurl>file:///footage/broll.mp4</pathurl>")
  })

  it("surfaces warnings when dropping unsupported core-only fields", () => {
    const warnings: string[] = []
    const xml = writeXMEML(
      makeTimeline({
        metadata: { project: "demo" },
        markers: [{ name: "intro" }],
        tracks: [
          {
            kind: "video",
            items: [
              makeTimeline().tracks[0].items[0],
              {
                kind: "transition",
                name: "cross-dissolve",
                inOffset: rational(10, 30),
                outOffset: rational(10, 30),
              },
              ...makeTimeline().tracks[0].items.slice(1),
            ],
          },
        ],
      }),
      {
        format: "xmeml",
        onWarning: (warning) => warnings.push(warning),
      },
    )

    expect(xml).toContain("<xmeml")
    expect(warnings.some((warning) => warning.toLowerCase().includes("transition"))).toBe(true)
    expect(warnings.some((warning) => warning.toLowerCase().includes("metadata"))).toBe(true)
    expect(warnings.some((warning) => warning.toLowerCase().includes("marker"))).toBe(true)
  })

  it("uses dropped-transition timing for exported sequence duration", () => {
    const xml = writeXMEML(
      makeTimeline({
        format: {
          width: 1920,
          height: 1080,
          frameRate: rational(24, 1),
          audioRate: 48000,
        },
        tracks: [
          {
            kind: "video",
            items: [
              {
                kind: "clip",
                name: "clip1",
                mediaReference: {
                  type: "external",
                  targetUrl: "file:///footage/clip1.mp4",
                  mediaKind: "video",
                },
                sourceRange: {
                  startTime: ZERO,
                  duration: rational(48, 24),
                },
              },
              {
                kind: "transition",
                name: "cross-dissolve",
                inOffset: rational(12, 24),
                outOffset: rational(12, 24),
              },
              {
                kind: "clip",
                name: "clip2",
                mediaReference: {
                  type: "external",
                  targetUrl: "file:///footage/clip2.mp4",
                  mediaKind: "video",
                },
                sourceRange: {
                  startTime: ZERO,
                  duration: rational(48, 24),
                },
              },
            ],
          },
        ],
      }),
    )

    expect(xml).toContain("<duration>96</duration>")
  })

  it("throws on invalid timeline", () => {
    expect(() => writeXMEML(makeTimeline({ name: "" }))).toThrow(
      "validation failed",
    )
  })
})

describe("readXMEML", () => {
  it("roundtrips through write/read into the core model", () => {
    const xml = writeXMEML(makeTimeline())
    const { timeline } = readXMEML(xml)

    expect(timeline.name).toBe("Test Sequence")
    expect(timeline.format.width).toBe(1920)
    expect(timeline.format.height).toBe(1080)

    const videoTrack = timeline.tracks.find((track) => track.kind === "video")
    expect(videoTrack).toBeDefined()
    expect(videoTrack!.items.map((item) => item.kind)).toEqual([
      "clip",
      "gap",
      "clip",
    ])
    expect(timeline.format.audioChannels).toBe(2)
  })

  it("preserves clip timing through roundtrip", () => {
    const original = makeTimeline()
    const xml = writeXMEML(original)
    const { timeline } = readXMEML(xml)

    const videoTrack = timeline.tracks.find((track) => track.kind === "video")
    expect(videoTrack).toBeDefined()

    const parsedFirst = expectClip(videoTrack!.items[0])
    const parsedSecond = expectClip(videoTrack!.items[2])

    expect(toSeconds(parsedFirst.sourceRange?.duration ?? ZERO)).toBeCloseTo(
      toSeconds((original.tracks[0].items[0] as any).sourceRange.duration),
      2,
    )
    expect(toSeconds(parsedSecond.sourceRange?.startTime ?? ZERO)).toBeCloseTo(
      toSeconds((original.tracks[0].items[2] as any).sourceRange.startTime),
      2,
    )
  })

  it("extracts inline media references", () => {
    const xml = writeXMEML(makeTimeline())
    const { timeline } = readXMEML(xml)

    const videoTrack = timeline.tracks.find((track) => track.kind === "video")
    const clip = expectClip(videoTrack!.items[0])
    expect(clip.mediaReference.type).toBe("external")
    if (clip.mediaReference.type !== "external") {
      throw new Error("expected external reference")
    }

    expect(clip.mediaReference.targetUrl).toBe("file:///footage/interview.mp4")
    expect(clip.mediaReference.streamInfo).toMatchObject({
      hasVideo: true,
      hasAudio: true,
    })
  })

  it("preserves still-image media references as image clips", () => {
    const xml = writeXMEML(
      makeTimeline({
        tracks: [
          {
            kind: "video",
            items: [
              {
                kind: "clip",
                name: "slide",
                mediaReference: {
                  type: "external",
                  name: "slide.png",
                  targetUrl: "file:///slides/slide.png",
                  mediaKind: "image",
                  availableRange: {
                    startTime: ZERO,
                    duration: rational(90 * 1001, 30000),
                  },
                  streamInfo: {
                    hasVideo: true,
                    hasAudio: false,
                    width: 1920,
                    height: 1080,
                    frameRate: rational(30000, 1001),
                  },
                },
                sourceRange: {
                  startTime: ZERO,
                  duration: rational(90 * 1001, 30000),
                },
              },
            ],
          },
        ],
      }),
    )

    const { timeline } = readXMEML(xml)
    const videoTrack = timeline.tracks.find((track) => track.kind === "video")
    const clip = expectClip(videoTrack!.items[0])

    expect(clip.mediaReference.type).toBe("external")
    if (clip.mediaReference.type !== "external") {
      throw new Error("expected external reference")
    }

    expect(clip.mediaReference.mediaKind).toBe("image")
    expect(clip.mediaReference.targetUrl).toBe("file:///slides/slide.png")
    expect(clip.mediaReference.streamInfo).toMatchObject({
      hasVideo: true,
      hasAudio: false,
    })
  })

  it("throws on invalid XML", () => {
    expect(() => readXMEML("<html>not xmeml</html>")).toThrow("Invalid xmeml")
  })

  it("throws on missing media element", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="seq-1">
    <name>No Media</name>
    <rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>
  </sequence>
</xmeml>`
    expect(() => readXMEML(xml)).toThrow("no <media>")
  })

  it("extracts sequence dimensions", () => {
    const xml = writeXMEML(makeTimeline())
    const { timeline } = readXMEML(xml)
    expect(timeline.format.width).toBe(1920)
    expect(timeline.format.height).toBe(1080)
  })

  it("roundtrips timecodeStart in sourceRange.startTime", () => {
    const tcStart = rational(108000 * 1001, 30000)
    const timeline = makeTimeline({
      tracks: [
        {
          kind: "video",
          items: [
            {
              kind: "clip",
              name: "tc-clip",
              mediaReference: {
                type: "external",
                name: "tc-clip.mp4",
                targetUrl: "file:///footage/tc-clip.mp4",
                mediaKind: "video",
                availableRange: {
                  startTime: tcStart,
                  duration: rational(900 * 1001, 30000),
                },
                streamInfo: {
                  hasVideo: true,
                  hasAudio: true,
                  width: 1920,
                  height: 1080,
                  frameRate: rational(30000, 1001),
                  audioRate: 48000,
                  audioChannels: 2,
                },
              },
              sourceRange: {
                startTime: rational(60 * 1001, 30000),
                duration: rational(150 * 1001, 30000),
              },
            },
          ],
        },
      ],
    })

    const xml = writeXMEML(timeline)
    const { timeline: imported } = readXMEML(xml)

    const videoTrack = imported.tracks.find((track) => track.kind === "video")
    const clip = expectClip(videoTrack!.items[0])
    expect(toSeconds(clip.sourceRange?.startTime ?? ZERO)).toBeCloseTo(
      toSeconds(rational(60 * 1001, 30000)),
      2,
    )
  })
})
