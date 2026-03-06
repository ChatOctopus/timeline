import { describe, it, expect } from "vitest"
import { writeFCPXML } from "../src/fcpxml/writer.js"
import { readFCPXML } from "../src/fcpxml/reader.js"
import type { NLETimeline } from "../src/types.js"
import { rational, ZERO, toSeconds, toFCPString } from "../src/time.js"

function makeTimeline(overrides?: Partial<NLETimeline>): NLETimeline {
  return {
    name: "Test Project",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(30000, 1001),
      audioRate: 48000,
      colorSpace: "1-1-1 (Rec. 709)",
    },
    assets: [
      {
        id: "r2",
        name: "clip1.mp4",
        path: "/videos/clip1.mp4",
        duration: rational(300 * 1001, 30000),
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
        duration: rational(600 * 1001, 30000),
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
            duration: rational(150 * 1001, 30000),
            sourceIn: ZERO,
            sourceDuration: rational(150 * 1001, 30000),
            audioRole: "dialogue",
          },
          {
            assetId: "r3",
            name: "clip2",
            offset: rational(150 * 1001, 30000),
            duration: rational(300 * 1001, 30000),
            sourceIn: rational(60 * 1001, 30000),
            sourceDuration: rational(300 * 1001, 30000),
            audioRole: "dialogue",
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("writeFCPXML", () => {
  it("generates valid FCPXML structure", () => {
    const xml = writeFCPXML(makeTimeline())

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain("<!DOCTYPE fcpxml>")
    expect(xml).toContain('<fcpxml version="1.8">')
    expect(xml).toContain("<resources>")
    expect(xml).toContain("<library>")
    expect(xml).toContain("<spine>")
  })

  it("includes format with frame duration", () => {
    const xml = writeFCPXML(makeTimeline())
    // 29.97fps -> frameDuration = 1001/30000s
    expect(xml).toContain('frameDuration="1001/30000s"')
    expect(xml).toContain('width="1920"')
    expect(xml).toContain('height="1080"')
  })

  it("includes assets with file URLs", () => {
    const xml = writeFCPXML(makeTimeline())
    expect(xml).toContain('src="file:///videos/clip1.mp4"')
    expect(xml).toContain('src="file:///videos/clip2.mp4"')
    expect(xml).toContain('hasVideo="1"')
    expect(xml).toContain('hasAudio="1"')
  })

  it("generates asset-clips in spine sorted by offset", () => {
    const xml = writeFCPXML(makeTimeline())
    const clip1Pos = xml.indexOf('name="clip1"')
    const clip2Pos = xml.indexOf('name="clip2"')
    expect(clip1Pos).toBeLessThan(clip2Pos)
  })

  it("includes volume adjustment when specified", () => {
    const xml = writeFCPXML(makeTimeline(), { format: "fcpxml", volumeDb: -13 })
    expect(xml).toContain("adjust-volume")
    expect(xml).toContain("-13dB")
  })

  it("omits volume adjustment when not specified", () => {
    const xml = writeFCPXML(makeTimeline())
    expect(xml).not.toContain("adjust-volume")
  })

  it("throws on invalid timeline", () => {
    expect(() => writeFCPXML(makeTimeline({ name: "" }))).toThrow(
      "validation failed",
    )
  })

  it("throws on missing asset reference", () => {
    const timeline = makeTimeline()
    timeline.tracks[0].clips[0].assetId = "nonexistent"
    expect(() => writeFCPXML(timeline)).toThrow("validation failed")
  })
})

describe("readFCPXML", () => {
  it("roundtrips through write/read", () => {
    const original = makeTimeline()
    const xml = writeFCPXML(original)
    const { timeline, warnings } = readFCPXML(xml)

    expect(timeline.name).toBe("Test Project")
    expect(timeline.format.width).toBe(1920)
    expect(timeline.format.height).toBe(1080)
    expect(timeline.assets.length).toBe(2)
    expect(timeline.tracks.length).toBe(1)
    expect(timeline.tracks[0].clips.length).toBe(2)
  })

  it("preserves clip timing through roundtrip", () => {
    const original = makeTimeline()
    const xml = writeFCPXML(original)
    const { timeline } = readFCPXML(xml)

    const origClips = original.tracks[0].clips
    const parsedClips = timeline.tracks[0].clips

    for (let i = 0; i < origClips.length; i++) {
      expect(toSeconds(parsedClips[i].offset)).toBeCloseTo(
        toSeconds(origClips[i].offset),
        3,
      )
      expect(toSeconds(parsedClips[i].duration)).toBeCloseTo(
        toSeconds(origClips[i].duration),
        3,
      )
    }
  })

  it("extracts asset metadata", () => {
    const xml = writeFCPXML(makeTimeline())
    const { timeline } = readFCPXML(xml)

    const asset = timeline.assets.find((a) => a.id === "r2")
    expect(asset).toBeDefined()
    expect(asset!.name).toBe("clip1.mp4")
    expect(asset!.hasVideo).toBe(true)
    expect(asset!.hasAudio).toBe(true)
  })

  it("throws on invalid XML", () => {
    expect(() => readFCPXML("<html><body>not xml</body></html>")).toThrow(
      "Invalid FCPXML",
    )
  })

  it("throws on missing resources element", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <library/>
</fcpxml>`
    expect(() => readFCPXML(xml)).toThrow("missing <resources>")
  })

  it("warns on unsupported FCPXML version", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="2.0">
  <resources>
    <format id="r1" width="1920" height="1080" frameDuration="1001/30000s"/>
  </resources>
  <library>
    <event name="Test">
      <project name="V2">
        <sequence duration="0s" format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine/>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`
    const { warnings } = readFCPXML(xml)
    expect(warnings.some((w) => w.includes("version 2.0"))).toBe(true)
  })

  it("warns on unsupported spine elements like mc-clip and title", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" width="1920" height="1080" frameDuration="1001/30000s"/>
    <asset id="r2" name="clip.mp4" src="file:///clip.mp4" start="0s" duration="300300/30000s" hasVideo="1" hasAudio="1" format="r1"/>
  </resources>
  <library>
    <event name="Test">
      <project name="Complex">
        <sequence duration="300300/30000s" format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <asset-clip name="clip" ref="r2" offset="0s" duration="150150/30000s" start="0s"/>
            <mc-clip name="multicam1" offset="150150/30000s" duration="30030/30000s"/>
            <title name="Title Card" offset="180180/30000s" duration="60060/30000s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`
    const { timeline, warnings } = readFCPXML(xml)
    expect(timeline.tracks[0].clips).toHaveLength(1)
    expect(warnings.some((w) => w.includes("<mc-clip>"))).toBe(true)
    expect(warnings.some((w) => w.includes("<title>"))).toBe(true)
  })

  it("parses minimal FCPXML", () => {
    const minimal = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" width="1920" height="1080" frameDuration="1001/30000s"/>
  </resources>
  <library>
    <event name="Test">
      <project name="Minimal">
        <sequence duration="0s" format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine/>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`

    const { timeline } = readFCPXML(minimal)
    expect(timeline.name).toBe("Minimal")
    expect(timeline.tracks).toHaveLength(0)
    expect(timeline.format.width).toBe(1920)
  })
})
