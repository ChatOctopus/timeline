import { describe, it, expect } from "vitest"
import { writeFCPXML } from "../src/fcpxml/writer.js"
import { readFCPXML } from "../src/fcpxml/reader.js"
import { writeXMEML } from "../src/xmeml/writer.js"
import { readXMEML } from "../src/xmeml/reader.js"
import { writeOTIO } from "../src/otio/writer.js"
import { readOTIO } from "../src/otio/reader.js"
import { validateTimeline } from "../src/validate.js"
import type { NLETimeline } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeMultiTrackTimeline(): NLETimeline {
  return {
    name: "Multi-Track",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(30000, 1001),
      audioRate: 48000,
    },
    assets: [
      {
        id: "r2",
        name: "main.mp4",
        path: "/footage/main.mp4",
        duration: rational(300 * 1001, 30000),
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
        name: "overlay.mp4",
        path: "/footage/overlay.mp4",
        duration: rational(150 * 1001, 30000),
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
    ],
    tracks: [
      {
        type: "video",
        clips: [
          {
            assetId: "r2",
            name: "main",
            offset: ZERO,
            duration: rational(300 * 1001, 30000),
            sourceIn: ZERO,
            sourceDuration: rational(300 * 1001, 30000),
          },
        ],
      },
      {
        type: "video",
        clips: [
          {
            assetId: "r3",
            name: "overlay",
            offset: rational(60 * 1001, 30000),
            duration: rational(150 * 1001, 30000),
            sourceIn: ZERO,
            sourceDuration: rational(150 * 1001, 30000),
            lane: 1,
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// High #1: Multi-track preservation
// ---------------------------------------------------------------------------

describe("audit: multi-track preservation (High #1)", () => {
  it("FCPXML writer includes clips from all video tracks", () => {
    const xml = writeFCPXML(makeMultiTrackTimeline())
    expect(xml).toContain('name="main"')
    expect(xml).toContain('name="overlay"')
  })

  it("FCPXML reader extracts connected clips from different lanes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" width="1920" height="1080" frameDuration="1001/30000s"/>
    <asset id="r2" name="main.mp4" src="file:///footage/main.mp4" start="0s" duration="300300/30000s" hasVideo="1" hasAudio="1" format="r1"/>
    <asset id="r3" name="overlay.mp4" src="file:///footage/overlay.mp4" start="0s" duration="150150/30000s" hasVideo="1" hasAudio="1" format="r1"/>
  </resources>
  <library>
    <event name="Test">
      <project name="Multi-Track">
        <sequence duration="300300/30000s" format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <asset-clip name="main" ref="r2" offset="0s" duration="300300/30000s" start="0s">
              <asset-clip lane="1" name="overlay" ref="r3" offset="60060/30000s" duration="150150/30000s" start="0s"/>
            </asset-clip>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`

    const { timeline } = readFCPXML(xml)
    const allClips = timeline.tracks.flatMap((t) => t.clips)

    expect(allClips.length).toBe(2)
    expect(allClips.find((c) => c.name === "main")).toBeDefined()
    expect(allClips.find((c) => c.name === "overlay")).toBeDefined()

    const videoTracks = timeline.tracks.filter((t) => t.type === "video")
    expect(videoTracks.length).toBe(2)
  })

  it("FCPXML roundtrips multi-track timeline", () => {
    const original = makeMultiTrackTimeline()
    const xml = writeFCPXML(original)
    const { timeline } = readFCPXML(xml)

    const allClips = timeline.tracks.flatMap((t) => t.clips)
    expect(allClips.length).toBe(2)

    const videoTracks = timeline.tracks.filter((t) => t.type === "video")
    expect(videoTracks.length).toBe(2)
  })

  it("xmeml writer creates track elements for each video track", () => {
    const xml = writeXMEML(makeMultiTrackTimeline())
    expect(xml).toContain("main")
    expect(xml).toContain("overlay")

    expect(xml).toContain('id="clipitem-video-1"')
    expect(xml).toContain('id="clipitem-video-2"')
  })

  it("xmeml reader preserves separate video tracks", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="seq-1">
    <name>Multi-Track</name>
    <duration>300</duration>
    <rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>
    <in>0</in><out>300</out>
    <timecode><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><width>1920</width><height>1080</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
        <track>
          <clipitem id="v1-clip">
            <name>main</name><enabled>TRUE</enabled><duration>300</duration>
            <start>0</start><end>300</end><in>0</in><out>300</out>
            <file id="file-r2"><name>main.mp4</name><pathurl>file:///footage/main.mp4</pathurl><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><duration>300</duration><timecode><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><samplecharacteristics><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><width>1920</width><height>1080</height></samplecharacteristics></video><audio><samplecharacteristics><samplerate>48000</samplerate><sampledepth>16</sampledepth></samplecharacteristics></audio></media></file>
            <sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
        </track>
        <track>
          <clipitem id="v2-clip">
            <name>overlay</name><enabled>TRUE</enabled><duration>150</duration>
            <start>60</start><end>210</end><in>0</in><out>150</out>
            <file id="file-r3"><name>overlay.mp4</name><pathurl>file:///footage/overlay.mp4</pathurl><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><duration>150</duration><timecode><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><samplecharacteristics><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><width>1920</width><height>1080</height></samplecharacteristics></video><audio><samplecharacteristics><samplerate>48000</samplerate><sampledepth>16</sampledepth></samplecharacteristics></audio></media></file>
            <sourcetrack><mediatype>video</mediatype><trackindex>2</trackindex></sourcetrack>
          </clipitem>
        </track>
      </video>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format><samplecharacteristics><samplerate>48000</samplerate><sampledepth>16</sampledepth></samplecharacteristics></format>
        <track/>
      </audio>
    </media>
  </sequence>
</xmeml>`

    const { timeline } = readXMEML(xml)
    const videoTracks = timeline.tracks.filter((t) => t.type === "video")
    expect(videoTracks.length).toBe(2)
    expect(videoTracks[0].clips[0].name).toBe("main")
    expect(videoTracks[1].clips[0].name).toBe("overlay")
  })

  it("xmeml roundtrips multi-track timeline", () => {
    const original = makeMultiTrackTimeline()
    const xml = writeXMEML(original)
    const { timeline } = readXMEML(xml)

    const videoTracks = timeline.tracks.filter((t) => t.type === "video")
    expect(videoTracks.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// High #2: OTIO timing fidelity
// ---------------------------------------------------------------------------

describe("audit: OTIO timing fidelity (High #2)", () => {
  it("reader preserves 23.976fps timing precisely", () => {
    const timeline: NLETimeline = {
      name: "NTSC Precision",
      format: {
        width: 1920,
        height: 1080,
        frameRate: rational(24000, 1001),
        audioRate: 48000,
      },
      assets: [
        {
          id: "r2",
          name: "clip.mp4",
          path: "/video/clip.mp4",
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
              name: "clip",
              offset: ZERO,
              duration: rational(120 * 1001, 24000),
              sourceIn: rational(24 * 1001, 24000),
              sourceDuration: rational(120 * 1001, 24000),
            },
          ],
        },
      ],
    }

    const json = writeOTIO(timeline)
    const { timeline: imported } = readOTIO(json)

    const origClip = timeline.tracks[0].clips[0]
    const importedClip = imported.tracks[0].items[0]
    expect(importedClip.kind).toBe("clip")
    if (importedClip.kind !== "clip") {
      throw new Error("expected clip")
    }

    expect(toSeconds(importedClip.sourceRange?.duration ?? ZERO)).toBeCloseTo(
      toSeconds(origClip.sourceDuration),
      3,
    )
    expect(toSeconds(importedClip.sourceRange?.startTime ?? ZERO)).toBeCloseTo(
      toSeconds(origClip.sourceIn),
      3,
    )
  })

  it("writer uses asset-native rate for source_range and available_range", () => {
    const timeline: NLETimeline = {
      name: "Mixed Rate",
      format: {
        width: 1920,
        height: 1080,
        frameRate: rational(30000, 1001),
        audioRate: 48000,
      },
      assets: [
        {
          id: "r2",
          name: "clip24p.mp4",
          path: "/video/clip24p.mp4",
          duration: rational(240, 24),
          hasVideo: true,
          hasAudio: true,
          videoFormat: {
            width: 1920,
            height: 1080,
            frameRate: rational(24, 1),
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
              name: "clip24p",
              offset: ZERO,
              duration: rational(150 * 1001, 30000),
              sourceIn: rational(48, 24),
              sourceDuration: rational(150 * 1001, 30000),
            },
          ],
        },
      ],
    }

    const json = writeOTIO(timeline)
    const parsed = JSON.parse(json)

    const clip = parsed.tracks.children[0].children[0]
    const mediaRef = clip.media_references.DEFAULT_MEDIA

    expect(mediaRef.available_range.duration.rate).toBe(24)
    expect(clip.source_range.start_time.rate).toBe(24)
  })

  it("mixed-rate roundtrip preserves source timing", () => {
    const timeline: NLETimeline = {
      name: "Mixed Rate RT",
      format: {
        width: 1920,
        height: 1080,
        frameRate: rational(30000, 1001),
        audioRate: 48000,
      },
      assets: [
        {
          id: "r2",
          name: "clip24p.mp4",
          path: "/video/clip24p.mp4",
          duration: rational(240, 24),
          hasVideo: true,
          hasAudio: true,
          videoFormat: {
            width: 1920,
            height: 1080,
            frameRate: rational(24, 1),
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
              name: "clip24p",
              offset: ZERO,
              duration: rational(150 * 1001, 30000),
              sourceIn: rational(48, 24),
              sourceDuration: rational(150 * 1001, 30000),
            },
          ],
        },
      ],
    }

    const json = writeOTIO(timeline)
    const { timeline: imported } = readOTIO(json)

    const importedClip = imported.tracks[0].items[0]
    expect(importedClip.kind).toBe("clip")
    if (importedClip.kind !== "clip") {
      throw new Error("expected clip")
    }

    expect(toSeconds(importedClip.sourceRange?.startTime ?? ZERO)).toBeCloseTo(
      2.0,
      3,
    )
  })
})

// ---------------------------------------------------------------------------
// High #4: Audio-only FCPXML import
// ---------------------------------------------------------------------------

describe("audit: audio-only FCPXML import (High #4)", () => {
  it("imports audio-only clips into audio tracks", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" width="1920" height="1080" frameDuration="1001/30000s"/>
    <asset id="r2" name="narration.wav" src="file:///audio/narration.wav" start="0s" duration="300300/30000s" hasAudio="1" audioRate="48000" audioChannels="2"/>
  </resources>
  <library>
    <event name="Audio Project">
      <project name="Audio Only">
        <sequence duration="300300/30000s" format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <asset-clip name="narration" ref="r2" offset="0s" duration="300300/30000s" start="0s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`

    const { timeline } = readFCPXML(xml)
    const allClips = timeline.tracks.flatMap((t) => t.clips)

    expect(allClips.length).toBe(1)
    expect(allClips[0].name).toBe("narration")

    const audioTracks = timeline.tracks.filter((t) => t.type === "audio")
    expect(audioTracks.length).toBe(1)
  })

  it("handles mixed audio+video timeline", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" width="1920" height="1080" frameDuration="1001/30000s"/>
    <asset id="r2" name="video.mp4" src="file:///video.mp4" start="0s" duration="300300/30000s" hasVideo="1" hasAudio="1" format="r1"/>
    <asset id="r3" name="music.wav" src="file:///music.wav" start="0s" duration="600600/30000s" hasAudio="1" audioRate="48000"/>
  </resources>
  <library>
    <event name="Test">
      <project name="Mixed">
        <sequence duration="600600/30000s" format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <asset-clip name="video" ref="r2" offset="0s" duration="300300/30000s" start="0s"/>
            <asset-clip name="music" ref="r3" offset="300300/30000s" duration="300300/30000s" start="0s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`

    const { timeline } = readFCPXML(xml)
    const allClips = timeline.tracks.flatMap((t) => t.clips)
    expect(allClips.length).toBe(2)

    const videoTracks = timeline.tracks.filter((t) => t.type === "video")
    const audioTracks = timeline.tracks.filter((t) => t.type === "audio")
    expect(videoTracks.length).toBeGreaterThanOrEqual(1)
    expect(audioTracks.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Medium #1: xmeml sparse file references
// ---------------------------------------------------------------------------

const sparseXmeml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="seq-1">
    <name>Sparse Test</name>
    <duration>300</duration>
    <rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>
    <in>0</in><out>300</out>
    <timecode><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><width>1920</width><height>1080</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
        <track>
          <clipitem id="clip1">
            <name>clip1</name><enabled>TRUE</enabled><duration>150</duration>
            <start>0</start><end>150</end><in>0</in><out>150</out>
            <file id="file-r2"/>
            <sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
          <clipitem id="clip2">
            <name>clip2</name><enabled>TRUE</enabled><duration>150</duration>
            <start>150</start><end>300</end><in>0</in><out>150</out>
            <file id="file-r2"><name>main.mp4</name><pathurl>file:///footage/main.mp4</pathurl><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><duration>600</duration><timecode><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><samplecharacteristics><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><width>1920</width><height>1080</height></samplecharacteristics></video><audio><samplecharacteristics><samplerate>48000</samplerate><sampledepth>16</sampledepth></samplecharacteristics></audio></media></file>
            <sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
        </track>
      </video>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format><samplecharacteristics><samplerate>48000</samplerate><sampledepth>16</sampledepth></samplecharacteristics></format>
        <track/>
      </audio>
    </media>
  </sequence>
</xmeml>`

describe("audit: xmeml sparse file references (Medium #1)", () => {
  it("merges full file definition over sparse reference", () => {
    const { timeline } = readXMEML(sparseXmeml)
    const asset = timeline.assets.find((a) => a.id === "file-r2")

    expect(asset).toBeDefined()
    expect(asset!.path).toBe("/footage/main.mp4")
    expect(asset!.name).toBe("main.mp4")
  })

  it("warns on sparse file reference with no metadata", () => {
    const { warnings } = readXMEML(sparseXmeml)
    expect(
      warnings.some(
        (w) =>
          w.toLowerCase().includes("incomplete") ||
          w.toLowerCase().includes("sparse") ||
          w.toLowerCase().includes("missing"),
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Medium #2: OTIO media reference stability
// ---------------------------------------------------------------------------

describe("audit: OTIO media reference stability (Medium #2)", () => {
  it("preserves missing references deterministically across multiple readOTIO calls", () => {
    const otio = {
      OTIO_SCHEMA: "Timeline.1",
      name: "Test",
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
                OTIO_SCHEMA: "Clip.2",
                name: "missing-clip",
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
                    OTIO_SCHEMA: "MissingReference.1",
                    metadata: {},
                    name: "",
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

    const json = JSON.stringify(otio)
    const { timeline: t1 } = readOTIO(json)
    const { timeline: t2 } = readOTIO(json)

    const clip1 = t1.tracks[0].items[0]
    const clip2 = t2.tracks[0].items[0]
    expect(clip1.kind).toBe("clip")
    expect(clip2.kind).toBe("clip")
    if (clip1.kind !== "clip" || clip2.kind !== "clip") {
      throw new Error("expected clips")
    }

    expect(clip1.mediaReference).toEqual(clip2.mediaReference)
  })

  it("keeps external references distinct for files with similar paths", () => {
    const path1 = "/project-a/footage/render/clip.mp4"
    const path2 = "/project-b/footage/render/clip.mp4"

    const sanitized1 = path1.replace(/[^a-zA-Z0-9]/g, "").slice(-20)
    const sanitized2 = path2.replace(/[^a-zA-Z0-9]/g, "").slice(-20)
    expect(sanitized1).toBe(sanitized2)

    const makeClip = (path: string, name: string) => ({
      OTIO_SCHEMA: "Clip.2",
      name,
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 0 },
        duration: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 48 },
      },
      media_references: {
        DEFAULT_MEDIA: {
          OTIO_SCHEMA: "ExternalReference.1",
          target_url: `file://${path}`,
          available_range: {
            OTIO_SCHEMA: "TimeRange.1",
            start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 0 },
            duration: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 240 },
          },
          metadata: {},
          name: "clip.mp4",
        },
      },
      active_media_reference_key: "DEFAULT_MEDIA",
      effects: [],
      markers: [],
      metadata: {},
      enabled: true,
    })

    const otio = {
      OTIO_SCHEMA: "Timeline.1",
      name: "Test",
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
              makeClip(path1, "clip-a"),
              makeClip(path2, "clip-b"),
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

    const { timeline } = readOTIO(JSON.stringify(otio))
    const firstClip = timeline.tracks[0].items[0]
    const secondClip = timeline.tracks[0].items[1]
    expect(firstClip.kind).toBe("clip")
    expect(secondClip.kind).toBe("clip")
    if (firstClip.kind !== "clip" || secondClip.kind !== "clip") {
      throw new Error("expected clips")
    }

    expect(firstClip.mediaReference.type).toBe("external")
    expect(secondClip.mediaReference.type).toBe("external")
    if (
      firstClip.mediaReference.type !== "external" ||
      secondClip.mediaReference.type !== "external"
    ) {
      throw new Error("expected external references")
    }

    expect(firstClip.mediaReference.targetUrl).toBe(`file://${path1}`)
    expect(secondClip.mediaReference.targetUrl).toBe(`file://${path2}`)
    expect(firstClip.mediaReference.targetUrl).not.toBe(
      secondClip.mediaReference.targetUrl,
    )
  })
})

// ---------------------------------------------------------------------------
// Medium #3: Validation source-range checks
// ---------------------------------------------------------------------------

describe("audit: validation source-range checks (Medium #3)", () => {
  it("errors when sourceIn + sourceDuration exceeds asset duration", () => {
    const timeline: NLETimeline = {
      name: "Overrun Test",
      format: {
        width: 1920,
        height: 1080,
        frameRate: rational(24, 1),
        audioRate: 48000,
      },
      assets: [
        {
          id: "r2",
          name: "clip.mp4",
          path: "/video/clip.mp4",
          duration: rational(240, 24),
          hasVideo: true,
          hasAudio: true,
        },
      ],
      tracks: [
        {
          type: "video",
          clips: [
            {
              assetId: "r2",
              name: "overrun",
              offset: ZERO,
              duration: rational(120, 24),
              sourceIn: rational(216, 24),
              sourceDuration: rational(120, 24),
            },
          ],
        },
      ],
    }

    const errors = validateTimeline(timeline)
    const sourceErrors = errors.filter(
      (e) =>
        e.type === "error" &&
        e.message.toLowerCase().includes("source") &&
        e.message.toLowerCase().includes("exceed"),
    )
    expect(sourceErrors.length).toBeGreaterThan(0)
  })

  it("errors when sourceIn is beyond asset duration", () => {
    const timeline: NLETimeline = {
      name: "Beyond Duration",
      format: {
        width: 1920,
        height: 1080,
        frameRate: rational(24, 1),
        audioRate: 48000,
      },
      assets: [
        {
          id: "r2",
          name: "clip.mp4",
          path: "/video/clip.mp4",
          duration: rational(240, 24),
          hasVideo: true,
          hasAudio: true,
        },
      ],
      tracks: [
        {
          type: "video",
          clips: [
            {
              assetId: "r2",
              name: "beyond",
              offset: ZERO,
              duration: rational(24, 24),
              sourceIn: rational(480, 24),
              sourceDuration: rational(24, 24),
            },
          ],
        },
      ],
    }

    const errors = validateTimeline(timeline)
    const sourceErrors = errors.filter(
      (e) => e.type === "error" && e.message.toLowerCase().includes("source"),
    )
    expect(sourceErrors.length).toBeGreaterThan(0)
  })
})
