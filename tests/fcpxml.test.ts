import { describe, it, expect } from "vitest"
import { writeFCPXML } from "../src/fcpxml/writer.js"
import { readFCPXML } from "../src/fcpxml/reader.js"
import type { Timeline, TrackItem } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    name: "Test Project",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(30000, 1001),
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
            name: "clip1",
            mediaReference: {
              type: "external",
              name: "clip1.mp4",
              targetUrl: "file:///videos/clip1.mp4",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(300 * 1001, 30000),
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
              duration: rational(150 * 1001, 30000),
            },
            metadata: {
              audioRole: "dialogue",
            },
          },
          {
            kind: "gap",
            sourceRange: {
              startTime: ZERO,
              duration: rational(30 * 1001, 30000),
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
                duration: rational(600 * 1001, 30000),
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
              duration: rational(300 * 1001, 30000),
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

describe("writeFCPXML", () => {
  it("generates valid FCPXML structure from the core model", () => {
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
    expect(xml).toContain('frameDuration="1001/30000s"')
    expect(xml).toContain('width="1920"')
    expect(xml).toContain('height="1080"')
  })

  it("includes assets deduped from media references", () => {
    const xml = writeFCPXML(makeTimeline())
    expect(xml).toContain('src="file:///videos/clip1.mp4"')
    expect(xml).toContain('src="file:///videos/clip2.mp4"')
    expect(xml).toContain('hasVideo="1"')
    expect(xml).toContain('hasAudio="1"')
  })

  it("writes explicit gaps from the primary track", () => {
    const xml = writeFCPXML(makeTimeline())
    expect(xml).toContain("<gap")
  })

  it("surfaces warnings when dropping unsupported core-only fields", () => {
    const warnings: string[] = []
    const xml = writeFCPXML(
      makeTimeline({
        metadata: { project: "demo" },
        markers: [{ name: "intro" }],
        tracks: [
          {
            kind: "video",
            items: [
              {
                kind: "transition",
                name: "cross-dissolve",
                inOffset: rational(10, 30),
                outOffset: rational(10, 30),
              },
              ...makeTimeline().tracks[0].items,
            ],
          },
        ],
      }),
      {
        format: "fcpxml",
        onWarning: (warning) => warnings.push(warning),
      },
    )

    expect(xml).toContain("<fcpxml")
    expect(warnings.some((warning) => warning.toLowerCase().includes("transition"))).toBe(true)
    expect(warnings.some((warning) => warning.toLowerCase().includes("metadata"))).toBe(true)
    expect(warnings.some((warning) => warning.toLowerCase().includes("marker"))).toBe(true)
  })

  it("throws on invalid timeline", () => {
    expect(() => writeFCPXML(makeTimeline({ name: "" }))).toThrow(
      "validation failed",
    )
  })
})

describe("readFCPXML", () => {
  it("roundtrips through write/read into the core model", () => {
    const xml = writeFCPXML(makeTimeline())
    const { timeline } = readFCPXML(xml)

    expect(timeline.name).toBe("Test Project")
    expect(timeline.format.width).toBe(1920)
    expect(timeline.format.height).toBe(1080)
    expect(timeline.tracks.length).toBe(1)
    expect(timeline.tracks[0].items.map((item) => item.kind)).toEqual([
      "clip",
      "gap",
      "clip",
    ])
  })

  it("preserves clip timing through roundtrip", () => {
    const original = makeTimeline()
    const xml = writeFCPXML(original)
    const { timeline } = readFCPXML(xml)

    const originalClips = original.tracks[0].items.filter((item) => item.kind === "clip")
    const parsedItems = timeline.tracks[0].items

    const parsedFirst = expectClip(parsedItems[0])
    const parsedSecond = expectClip(parsedItems[2])

    expect(toSeconds(parsedFirst.sourceRange?.duration ?? ZERO)).toBeCloseTo(
      toSeconds(originalClips[0].sourceRange?.duration ?? ZERO),
      3,
    )
    expect(toSeconds(parsedSecond.sourceRange?.startTime ?? ZERO)).toBeCloseTo(
      toSeconds(originalClips[1].sourceRange?.startTime ?? ZERO),
      3,
    )
  })

  it("extracts inline media references", () => {
    const xml = writeFCPXML(makeTimeline())
    const { timeline } = readFCPXML(xml)

    const firstClip = expectClip(timeline.tracks[0].items[0])
    expect(firstClip.mediaReference.type).toBe("external")
    if (firstClip.mediaReference.type !== "external") {
      throw new Error("expected external reference")
    }

    expect(firstClip.mediaReference.name).toBe("clip1.mp4")
    expect(firstClip.mediaReference.targetUrl).toBe("file:///videos/clip1.mp4")
    expect(firstClip.mediaReference.streamInfo).toMatchObject({
      hasVideo: true,
      hasAudio: true,
    })
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
    expect(warnings.some((warning) => warning.includes("version 2.0"))).toBe(true)
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
    expect(timeline.tracks[0].items).toHaveLength(1)
    expect(warnings.some((warning) => warning.includes("<mc-clip>"))).toBe(true)
    expect(warnings.some((warning) => warning.includes("<title>"))).toBe(true)
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
