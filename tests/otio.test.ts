import { describe, it, expect } from "vitest"
import { writeOTIO } from "../src/otio/writer.js"
import { readOTIO } from "../src/otio/reader.js"
import { exportTimeline, importTimeline } from "../src/index.js"
import type { NLETimeline } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeTimeline(overrides?: Partial<NLETimeline>): NLETimeline {
  return {
    name: "OTIO Test",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(24000, 1001),
      audioRate: 48000,
      colorSpace: "1-1-1 (Rec. 709)",
    },
    assets: [
      {
        id: "r2",
        name: "clip1.mp4",
        path: "/videos/clip1.mp4",
        duration: rational(240 * 1001, 24000),
        hasVideo: true,
        hasAudio: true,
        audioChannels: 2,
        audioRate: 48000,
        timecodeStart: ZERO,
      },
      {
        id: "r3",
        name: "clip2.mp4",
        path: "/videos/clip2.mp4",
        duration: rational(480 * 1001, 24000),
        hasVideo: true,
        hasAudio: true,
        audioChannels: 2,
        audioRate: 48000,
        timecodeStart: ZERO,
      },
    ],
    tracks: [
      {
        type: "video",
        clips: [
          {
            assetId: "r2",
            name: "clip1",
            offset: ZERO,
            duration: rational(120 * 1001, 24000),
            sourceIn: ZERO,
            sourceDuration: rational(120 * 1001, 24000),
          },
          {
            assetId: "r3",
            name: "clip2",
            offset: rational(120 * 1001, 24000),
            duration: rational(240 * 1001, 24000),
            sourceIn: rational(48 * 1001, 24000),
            sourceDuration: rational(240 * 1001, 24000),
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("writeOTIO", () => {
  it("generates valid OTIO JSON", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1")
    expect(parsed.name).toBe("OTIO Test")
    expect(parsed.tracks.OTIO_SCHEMA).toBe("Stack.1")
  })

  it("includes tracks with correct kind", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    const tracks = parsed.tracks.children
    expect(tracks).toHaveLength(1)
    expect(tracks[0].OTIO_SCHEMA).toBe("Track.1")
    expect(tracks[0].kind).toBe("Video")
  })

  it("includes clips with source_range", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    const clips = parsed.tracks.children[0].children
    expect(clips).toHaveLength(2)
    expect(clips[0].OTIO_SCHEMA).toBe("Clip.2")
    expect(clips[0].name).toBe("clip1")
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

  it("preserves format metadata in @ChatOctopus/timeline namespace", () => {
    const json = writeOTIO(makeTimeline())
    const parsed = JSON.parse(json)

    const meta = parsed.metadata["@ChatOctopus/timeline"].format
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
  it("roundtrips through write/read", () => {
    const original = makeTimeline()
    const json = writeOTIO(original)
    const { timeline, warnings } = readOTIO(json)

    expect(timeline.name).toBe("OTIO Test")
    expect(timeline.tracks).toHaveLength(1)
    expect(timeline.tracks[0].clips).toHaveLength(2)
    expect(timeline.assets.length).toBeGreaterThanOrEqual(2)
  })

  it("preserves clip timing through roundtrip", () => {
    const original = makeTimeline()
    const json = writeOTIO(original)
    const { timeline } = readOTIO(json)

    const origClips = original.tracks[0].clips
    const parsedClips = timeline.tracks[0].clips

    for (let i = 0; i < origClips.length; i++) {
      expect(toSeconds(parsedClips[i].offset)).toBeCloseTo(
        toSeconds(origClips[i].offset),
        1,
      )
      // OTIO uses integer frame counts so NTSC rates have ~0.01s rounding
      expect(toSeconds(parsedClips[i].duration)).toBeCloseTo(
        toSeconds(origClips[i].duration),
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
  })

  it("extracts asset paths from media references", () => {
    const json = writeOTIO(makeTimeline())
    const { timeline } = readOTIO(json)

    const paths = timeline.assets.map((a) => a.path)
    expect(paths).toContain("/videos/clip1.mp4")
    expect(paths).toContain("/videos/clip2.mp4")
  })

  it("throws on invalid JSON", () => {
    expect(() => readOTIO("not json at all")).toThrow("Invalid OTIO")
  })

  it("throws on wrong top-level schema", () => {
    const wrong = JSON.stringify({ OTIO_SCHEMA: "Clip.2", name: "test" })
    expect(() => readOTIO(wrong)).toThrow("Unsupported OTIO top-level schema")
  })

  it("handles gaps between clips", () => {
    const timeline = makeTimeline()
    // Insert a gap: clip2 starts at 10s but clip1 ends at 5s
    timeline.tracks[0].clips[1].offset = rational(240 * 1001, 24000)
    const json = writeOTIO(timeline)
    const parsed = JSON.parse(json)

    const children = parsed.tracks.children[0].children
    const hasGap = children.some(
      (c: any) => c.OTIO_SCHEMA && c.OTIO_SCHEMA.startsWith("Gap."),
    )
    expect(hasGap).toBe(true)

    const { timeline: reimported } = readOTIO(json)
    expect(reimported.tracks[0].clips).toHaveLength(2)
    expect(toSeconds(reimported.tracks[0].clips[1].offset)).toBeCloseTo(
      toSeconds(rational(240 * 1001, 24000)),
      1,
    )
  })

  it("warns on transitions", () => {
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
    expect(timeline.tracks[0].clips).toHaveLength(1)
    expect(warnings.some((w) => w.includes("Transition"))).toBe(true)
  })
})

describe("OTIO via public API", () => {
  it("exportTimeline with 'otio' editor", () => {
    const json = exportTimeline(makeTimeline(), "otio")
    const parsed = JSON.parse(json)
    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1")
  })

  it("importTimeline auto-detects OTIO", () => {
    const json = exportTimeline(makeTimeline(), "otio")
    const { timeline } = importTimeline(json)
    expect(timeline.name).toBe("OTIO Test")
    expect(timeline.tracks[0].clips).toHaveLength(2)
  })
})

describe("cross-format OTIO conversions", () => {
  it("converts FCPXML -> OTIO", () => {
    const original = makeTimeline()
    const fcpxml = exportTimeline(original, "fcpx")
    const { timeline } = importTimeline(fcpxml)
    const otio = exportTimeline(timeline, "otio")

    const parsed = JSON.parse(otio)
    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1")
    expect(parsed.tracks.children[0].children.length).toBeGreaterThan(0)
  })

  it("converts OTIO -> xmeml", () => {
    const original = makeTimeline()
    const otio = exportTimeline(original, "otio")
    const { timeline } = importTimeline(otio)
    const xmeml = exportTimeline(timeline, "premiere")

    expect(xmeml).toContain("<xmeml")
    expect(xmeml).toContain("clip1")
  })

  it("converts OTIO -> FCPXML", () => {
    const original = makeTimeline()
    const otio = exportTimeline(original, "otio")
    const { timeline } = importTimeline(otio)
    const fcpxml = exportTimeline(timeline, "fcpx")

    expect(fcpxml).toContain("<fcpxml")
    expect(fcpxml).toContain("clip1")
  })
})
