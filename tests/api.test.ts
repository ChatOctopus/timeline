import { describe, it, expect } from "vitest"
import { exportTimeline, importTimeline } from "../src/index.js"
import type { NLETimeline } from "../src/types.js"
import { rational, ZERO } from "../src/time.js"

function makeTimeline(): NLETimeline {
  return {
    name: "API Test",
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
        name: "scene1.mov",
        path: "/media/scene1.mov",
        duration: rational(240 * 1001, 24000),
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
            name: "scene1",
            offset: ZERO,
            duration: rational(120 * 1001, 24000),
            sourceIn: ZERO,
            sourceDuration: rational(120 * 1001, 24000),
          },
        ],
      },
    ],
  }
}

describe("exportTimeline", () => {
  it("exports FCPXML for fcpx editor", () => {
    const xml = exportTimeline(makeTimeline(), "fcpx")
    expect(xml).toContain("<fcpxml")
    expect(xml).toContain("<!DOCTYPE fcpxml>")
  })

  it("exports xmeml for premiere editor", () => {
    const xml = exportTimeline(makeTimeline(), "premiere")
    expect(xml).toContain("<xmeml")
    expect(xml).toContain('version="5"')
  })

  it("exports xmeml for resolve editor", () => {
    const xml = exportTimeline(makeTimeline(), "resolve")
    expect(xml).toContain("<xmeml")
  })
})

describe("importTimeline", () => {
  it("auto-detects FCPXML format", () => {
    const xml = exportTimeline(makeTimeline(), "fcpx")
    const result = importTimeline(xml)
    expect(result.timeline.name).toBe("API Test")
    expect(result.timeline.tracks.length).toBe(1)
  })

  it("auto-detects xmeml format", () => {
    const xml = exportTimeline(makeTimeline(), "premiere")
    const result = importTimeline(xml)
    expect(result.timeline.name).toBe("API Test")
  })

  it("throws on unknown format", () => {
    expect(() => importTimeline("<root>unknown</root>")).toThrow(
      "Unrecognized format",
    )
  })
})

describe("cross-format conversion", () => {
  it("converts FCPXML to xmeml via roundtrip", () => {
    const original = makeTimeline()
    const fcpxml = exportTimeline(original, "fcpx")
    const { timeline: imported } = importTimeline(fcpxml)

    const xmeml = exportTimeline(imported, "premiere")
    expect(xmeml).toContain("<xmeml")
    expect(xmeml).toContain("scene1")
  })

  it("converts xmeml to FCPXML via roundtrip", () => {
    const original = makeTimeline()
    const xmeml = exportTimeline(original, "premiere")
    const { timeline: imported } = importTimeline(xmeml)

    const fcpxml = exportTimeline(imported, "fcpx")
    expect(fcpxml).toContain("<fcpxml")
    expect(fcpxml).toContain("scene1")
  })
})
