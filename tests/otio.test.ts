import { describe, expect, it } from "vitest"
import { writeOTIO } from "../src/otio/writer.js"
import { readOTIO } from "../src/otio/reader.js"
import { exportTimeline, importTimeline } from "../src/index.js"
import type { Timeline } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    name: "OTIO Test",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(24000, 1001),
      audioRate: 48000,
      audioChannels: 2,
      audioLayout: "stereo",
      colorSpace: "1-1-1 (Rec. 709)",
    },
    tracks: [
      {
        kind: "video",
        name: "V1",
        items: [
          {
            kind: "clip",
            name: "clip1",
            mediaReference: {
              type: "external",
              name: "clip1.mp4",
              targetUrl: "file:///videos/clip1.mp4",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(240 * 1001, 24000),
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
              startTime: ZERO,
              duration: rational(120 * 1001, 24000),
            },
          },
          {
            kind: "clip",
            name: "clip2",
            mediaReference: {
              type: "external",
              name: "clip2.mp4",
              targetUrl: "file:///videos/clip2.mp4",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(480 * 1001, 24000),
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
              startTime: rational(48 * 1001, 24000),
              duration: rational(240 * 1001, 24000),
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

function expectClip(item: Timeline["tracks"][number]["items"][number]) {
  expect(item.kind).toBe("clip")
  if (item.kind !== "clip") {
    throw new Error("expected clip")
  }

  return item
}

describe("writeOTIO", () => {
  it("generates valid OTIO JSON from the core model", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1")
    expect(parsed.name).toBe("OTIO Test")
    expect(parsed.tracks.OTIO_SCHEMA).toBe("Stack.1")
  })

  it("includes tracks and clips with OTIO-native structure", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    const tracks = parsed.tracks.children
    expect(tracks).toHaveLength(1)
    expect(tracks[0].OTIO_SCHEMA).toBe("Track.1")
    expect(tracks[0].kind).toBe("Video")

    const clips = tracks[0].children
    expect(clips).toHaveLength(2)
    expect(clips[0].OTIO_SCHEMA).toBe("Clip.2")
    expect(clips[0].source_range.OTIO_SCHEMA).toBe("TimeRange.1")
    expect(clips[0].source_range.duration.OTIO_SCHEMA).toBe("RationalTime.1")
  })

  it("includes media references with target_url", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    const clip = parsed.tracks.children[0].children[0]
    const mediaRef = clip.media_references.DEFAULT_MEDIA
    expect(mediaRef.OTIO_SCHEMA).toBe("ExternalReference.1")
    expect(mediaRef.target_url).toBe("file:///videos/clip1.mp4")
  })

  it("preserves format metadata in the package namespace", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    const meta = parsed.metadata["@chatoctopus/timeline"].format
    expect(meta.width).toBe(1920)
    expect(meta.height).toBe(1080)
    expect(meta.audioRate).toBe(48000)
  })

  it("throws on invalid timeline", () => {
    expect(() => writeOTIO(makeTimeline({ name: "" }))).toThrow(
      "validation failed",
    )
  })
})

describe("readOTIO", () => {
  it("roundtrips through write/read into the core model", () => {
    const json = writeOTIO(makeTimeline())
    const { timeline, warnings } = readOTIO(json)

    expect(warnings).toEqual([])
    expect(timeline.name).toBe("OTIO Test")
    expect(timeline.tracks).toHaveLength(1)
    expect(timeline.tracks[0].items).toHaveLength(2)

    const firstClip = expectClip(timeline.tracks[0].items[0])
    expect(firstClip.mediaReference.type).toBe("external")
  })

  it("preserves clip timing through roundtrip", () => {
    const original = makeTimeline()
    const json = writeOTIO(original)
    const { timeline } = readOTIO(json)

    const originalClips = original.tracks[0].items.map((item) => expectClip(item))
    const importedClips = timeline.tracks[0].items.map((item) => expectClip(item))

    for (let i = 0; i < originalClips.length; i++) {
      expect(toSeconds(importedClips[i].sourceRange?.startTime ?? ZERO)).toBeCloseTo(
        toSeconds(originalClips[i].sourceRange?.startTime ?? ZERO),
        1,
      )
      expect(toSeconds(importedClips[i].sourceRange?.duration ?? ZERO)).toBeCloseTo(
        toSeconds(originalClips[i].sourceRange?.duration ?? ZERO),
        1,
      )
    }
  })

  it("preserves format dimensions from metadata", () => {
    const json = writeOTIO(makeTimeline())
    const { timeline } = readOTIO(json)

    expect(timeline.format.width).toBe(1920)
    expect(timeline.format.height).toBe(1080)
    expect(timeline.format.audioRate).toBe(48000)
    expect(timeline.format.audioChannels).toBe(2)
    expect(timeline.format.audioLayout).toBe("stereo")
  })

  it("preserves external target URLs", () => {
    const json = writeOTIO(makeTimeline())
    const { timeline } = readOTIO(json)

    const targetUrls = timeline.tracks[0].items.map((item) => {
      const clip = expectClip(item)
      expect(clip.mediaReference.type).toBe("external")
      if (clip.mediaReference.type !== "external") {
        throw new Error("expected external media reference")
      }
      return clip.mediaReference.targetUrl
    })

    expect(targetUrls).toContain("file:///videos/clip1.mp4")
    expect(targetUrls).toContain("file:///videos/clip2.mp4")
  })

  it("throws on invalid JSON", () => {
    expect(() => readOTIO("not json at all")).toThrow("Invalid OTIO")
  })

  it("throws on wrong top-level schema", () => {
    const wrong = JSON.stringify({ OTIO_SCHEMA: "Clip.2", name: "test" })
    expect(() => readOTIO(wrong)).toThrow("Unsupported OTIO top-level schema")
  })

  it("roundtrips explicit gaps", () => {
    const timeline = makeTimeline({
      tracks: [
        {
          kind: "video",
          name: "V1",
          items: [
            makeTimeline().tracks[0].items[0],
            {
              kind: "gap",
              sourceRange: {
                startTime: ZERO,
                duration: rational(120 * 1001, 24000),
              },
            },
            makeTimeline().tracks[0].items[1],
          ],
        },
      ],
    })

    const { timeline: reimported } = readOTIO(writeOTIO(timeline))
    expect(reimported.tracks[0].items.map((item) => item.kind)).toEqual([
      "clip",
      "gap",
      "clip",
    ])

    const gap = reimported.tracks[0].items[1]
    expect(gap.kind).toBe("gap")
    if (gap.kind !== "gap") {
      throw new Error("expected gap")
    }

    expect(toSeconds(gap.sourceRange.duration)).toBeCloseTo(
      toSeconds(rational(120 * 1001, 24000)),
      1,
    )
  })

  it("preserves transitions from OTIO instead of dropping them", () => {
    const otio = {
      OTIO_SCHEMA: "Timeline.1",
      name: "With Transition",
      global_start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 0 },
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        name: "tracks",
        children: [
          {
            OTIO_SCHEMA: "Track.1",
            name: "V1",
            kind: "Video",
            children: [
              {
                OTIO_SCHEMA: "Transition.1",
                name: "dissolve",
                transition_type: "SMPTE_Dissolve",
                in_offset: {
                  OTIO_SCHEMA: "RationalTime.1",
                  rate: 24,
                  value: 10,
                },
                out_offset: {
                  OTIO_SCHEMA: "RationalTime.1",
                  rate: 24,
                  value: 10,
                },
                metadata: {},
              },
              {
                OTIO_SCHEMA: "Clip.2",
                name: "test",
                source_range: {
                  OTIO_SCHEMA: "TimeRange.1",
                  start_time: {
                    OTIO_SCHEMA: "RationalTime.1",
                    rate: 24,
                    value: 0,
                  },
                  duration: {
                    OTIO_SCHEMA: "RationalTime.1",
                    rate: 24,
                    value: 48,
                  },
                },
                media_references: {
                  DEFAULT_MEDIA: {
                    OTIO_SCHEMA: "ExternalReference.1",
                    target_url: "file:///test.mp4",
                    available_range: {
                      OTIO_SCHEMA: "TimeRange.1",
                      start_time: {
                        OTIO_SCHEMA: "RationalTime.1",
                        rate: 24,
                        value: 0,
                      },
                      duration: {
                        OTIO_SCHEMA: "RationalTime.1",
                        rate: 24,
                        value: 100,
                      },
                    },
                    metadata: {},
                    name: "test.mp4",
                  },
                },
                active_media_reference_key: "DEFAULT_MEDIA",
                effects: [],
                markers: [],
                metadata: {},
                enabled: true,
              },
            ],
            source_range: null,
            effects: [],
            markers: [],
            metadata: {},
            enabled: true,
          },
        ],
        source_range: null,
        effects: [],
        markers: [],
        metadata: {},
        enabled: true,
      },
      metadata: {},
    }

    const { timeline, warnings } = readOTIO(JSON.stringify(otio))
    expect(warnings).toEqual([])
    expect(timeline.tracks[0].items.map((item) => item.kind)).toEqual([
      "transition",
      "clip",
    ])
  })
})

describe("OTIO via public API", () => {
  it("exportTimeline with 'otio' editor", () => {
    const json = exportTimeline(makeTimeline(), "otio")
    const parsed = JSON.parse(json)
    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1")
  })

  it("importTimeline auto-detects OTIO into the core model", () => {
    const json = exportTimeline(makeTimeline(), "otio")
    const timeline = importTimeline(json).timeline

    expect(timeline.name).toBe("OTIO Test")
    expect(timeline.tracks[0].items).toHaveLength(2)
  })
})

describe("cross-format OTIO conversions", () => {
  it("converts FCPXML -> OTIO", () => {
    const fcpxml = exportTimeline(makeTimeline(), "fcpx")
    const { timeline } = importTimeline(fcpxml)
    const otio = exportTimeline(timeline, "otio")

    const parsed = JSON.parse(otio)
    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1")
    expect(parsed.tracks.children[0].children.length).toBeGreaterThan(0)
  })

  it("converts OTIO -> xmeml", () => {
    const otio = exportTimeline(makeTimeline(), "otio")
    const timeline = importTimeline(otio).timeline
    const xmeml = exportTimeline(timeline, "premiere")

    expect(xmeml).toContain("<xmeml")
    expect(xmeml).toContain("clip1")
  })

  it("converts OTIO -> FCPXML", () => {
    const otio = exportTimeline(makeTimeline(), "otio")
    const timeline = importTimeline(otio).timeline
    const fcpxml = exportTimeline(timeline, "fcpx")

    expect(fcpxml).toContain("<fcpxml")
    expect(fcpxml).toContain("clip1")
  })
})
