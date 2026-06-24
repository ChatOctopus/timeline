import { describe, expect, it } from "vitest"
import { sanitizeContent } from "../src/sanitize.js"
import { importTimeline } from "../src/index.js"

describe("sanitizeContent", () => {
  it("rewrites file:// URLs in FCPXML and drops the original path", () => {
    const raw = `<asset src="file:///Users/jane/Movies/Client%20Cut/a.mov"/>`
    const { content, mappings } = sanitizeContent(raw)

    expect(content).not.toContain("/Users/jane")
    expect(content).toContain("file:///media/clip-0001.mov")
    expect(mappings).toEqual([
      {
        from: "file:///Users/jane/Movies/Client%20Cut/a.mov",
        to: "file:///media/clip-0001.mov",
      },
    ])
  })

  it("maps the same source path to the same placeholder (preserves links)", () => {
    const raw = `
      <pathurl>file://localhost/Volumes/SSD/shoot/b.mp4</pathurl>
      <pathurl>file://localhost/Volumes/SSD/shoot/b.mp4</pathurl>
      <pathurl>file://localhost/Volumes/SSD/shoot/c.wav</pathurl>`
    const { content, mappings } = sanitizeContent(raw)

    expect(mappings).toHaveLength(2)
    expect(content).not.toContain("/Volumes/SSD")
    expect(content.match(/clip-0001\.mp4/g)).toHaveLength(2)
    expect(content).toContain("clip-0002.wav")
  })

  it("scrubs OTIO target_url values", () => {
    const raw = `{"OTIO_SCHEMA":"x","target_url":"file:///Users/bob/edit/d.mov"}`
    const { content } = sanitizeContent(raw)

    expect(content).not.toContain("/Users/bob")
    expect(content).toContain("file:///media/clip-0001.mov")
  })

  it("scrubs bare absolute paths without a scheme", () => {
    const { content } = sanitizeContent("path=/Volumes/Media/raw/e.mxf end")
    expect(content).toContain("/media/clip-0001.mxf")
    expect(content).not.toContain("/Volumes/Media")
  })

  it("is idempotent -- re-running does not renumber placeholders", () => {
    const raw = `<asset src="file:///Users/jane/a.mov"/>`
    const once = sanitizeContent(raw).content
    const twice = sanitizeContent(once).content
    expect(twice).toBe(once)
  })

  it("produces a fixture that still imports cleanly", () => {
    const raw = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.8">
  <resources>
    <format id="r1" frameDuration="1001/30000s" width="1920" height="1080"/>
    <asset id="a1" name="a" start="0s" duration="3003/30000s" format="r1">
      <media-rep kind="original-media" src="file:///Users/jane/Movies/secret-client/a.mov"/>
    </asset>
  </resources>
  <library>
    <event name="E">
      <project name="P">
        <sequence format="r1">
          <spine>
            <asset-clip ref="a1" name="a" offset="0s" duration="3003/30000s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`
    const { content } = sanitizeContent(raw)

    expect(content).not.toContain("/Users/jane")
    expect(content).not.toContain("secret-client")
    const { timeline } = importTimeline(content)
    expect(timeline.tracks.length).toBeGreaterThan(0)
  })
})
