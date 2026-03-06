import { describe, it, expect } from "vitest"
import { writeXMEML } from "../src/xmeml/writer.js"
import { readXMEML } from "../src/xmeml/reader.js"
import type { NLETimeline } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeTimeline(overrides?: Partial<NLETimeline>): NLETimeline {
  return {
    name: "Test Sequence",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(30000, 1001),
      audioRate: 48000,
    },
    assets: [
      {
        id: "r2",
        name: "interview.mp4",
        path: "/footage/interview.mp4",
        duration: rational(900 * 1001, 30000),
        hasVideo: true,
        hasAudio: true,
        videoFormat: {
          width: 1920,
          height: 1080,
          frameRate: rational(30000, 1001),
          audioRate: 48000,
        },
        audioChannels: 2,
        audioRate: 48000,
        timecodeStart: ZERO,
      },
      {
        id: "r3",
        name: "broll.mp4",
        path: "/footage/broll.mp4",
        duration: rational(450 * 1001, 30000),
        hasVideo: true,
        hasAudio: true,
        videoFormat: {
          width: 1920,
          height: 1080,
          frameRate: rational(24000, 1001),
          audioRate: 48000,
        },
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
            name: "interview",
            offset: ZERO,
            duration: rational(300 * 1001, 30000),
            sourceIn: ZERO,
            sourceDuration: rational(300 * 1001, 30000),
          },
          {
            assetId: "r3",
            name: "broll",
            offset: rational(300 * 1001, 30000),
            duration: rational(150 * 1001, 30000),
            sourceIn: rational(30 * 1001, 24000),
            sourceDuration: rational(150 * 1001, 30000),
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("writeXMEML", () => {
  it("generates valid xmeml v5 structure", () => {
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

  it("includes samplecharacteristics for audio", () => {
    const xml = writeXMEML(makeTimeline())
    expect(xml).toContain("<samplerate>48000</samplerate>")
    expect(xml).toContain("<sampledepth>16</sampledepth>")
  })

  it("throws on invalid timeline", () => {
    expect(() => writeXMEML(makeTimeline({ name: "" }))).toThrow(
      "validation failed",
    )
  })
})

describe("readXMEML", () => {
  it("roundtrips through write/read", () => {
    const original = makeTimeline()
    const xml = writeXMEML(original)
    const { timeline } = readXMEML(xml)

    expect(timeline.name).toBe("Test Sequence")
    expect(timeline.format.width).toBe(1920)
    expect(timeline.format.height).toBe(1080)
    expect(timeline.assets.length).toBeGreaterThanOrEqual(2)
    expect(timeline.tracks.length).toBeGreaterThanOrEqual(1)
  })

  it("preserves clip count through roundtrip", () => {
    const original = makeTimeline()
    const xml = writeXMEML(original)
    const { timeline } = readXMEML(xml)

    const videoTrack = timeline.tracks.find((t) => t.type === "video")
    expect(videoTrack).toBeDefined()
    expect(videoTrack!.clips.length).toBe(2)
  })

  it("preserves clip timing through roundtrip", () => {
    const original = makeTimeline()
    const xml = writeXMEML(original)
    const { timeline } = readXMEML(xml)

    const videoTrack = timeline.tracks.find((t) => t.type === "video")
    const origClips = original.tracks[0].clips
    const parsedClips = videoTrack!.clips

    expect(toSeconds(parsedClips[0].offset)).toBeCloseTo(
      toSeconds(origClips[0].offset),
      2,
    )
    expect(toSeconds(parsedClips[1].offset)).toBeCloseTo(
      toSeconds(origClips[1].offset),
      2,
    )
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

  it("roundtrips timecodeStart in sourceIn", () => {
    const tcStart = rational(108000 * 1001, 30000)
    const timeline: NLETimeline = {
      name: "TC Test",
      format: {
        width: 1920,
        height: 1080,
        frameRate: rational(30000, 1001),
        audioRate: 48000,
      },
      assets: [
        {
          id: "r2",
          name: "tc-clip.mp4",
          path: "/footage/tc-clip.mp4",
          duration: rational(900 * 1001, 30000),
          hasVideo: true,
          hasAudio: true,
          videoFormat: {
            width: 1920,
            height: 1080,
            frameRate: rational(30000, 1001),
            audioRate: 48000,
          },
          audioChannels: 2,
          audioRate: 48000,
          timecodeStart: tcStart,
        },
      ],
      tracks: [
        {
          type: "video",
          clips: [
            {
              assetId: "r2",
              name: "tc-clip",
              offset: ZERO,
              duration: rational(150 * 1001, 30000),
              sourceIn: rational(60 * 1001, 30000),
              sourceDuration: rational(150 * 1001, 30000),
            },
          ],
        },
      ],
    }

    const xml = writeXMEML(timeline)
    const { timeline: imported } = readXMEML(xml)

    const videoTrack = imported.tracks.find((t) => t.type === "video")
    expect(videoTrack).toBeDefined()
    const clip = videoTrack!.clips[0]
    expect(toSeconds(clip.sourceIn)).toBeCloseTo(
      toSeconds(rational(60 * 1001, 30000)),
      2,
    )
  })
})
