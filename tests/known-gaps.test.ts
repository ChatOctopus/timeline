import { describe, it, expect } from "vitest"
import { writeFCPXML } from "../src/fcpxml/writer.js"
import { writeXMEML } from "../src/xmeml/writer.js"
import { writeOTIO } from "../src/otio/writer.js"
import type { NLETimeline } from "../src/types.js"
import { rational, ZERO } from "../src/time.js"

const FRAME_RATE = rational(30000, 1001)

function frames(frameCount: number) {
  return rational(frameCount * 1001, 30000)
}

describe("known gaps: fcpxml export", () => {
  it("keeps connected clips even when they start in a timeline gap", () => {
    const timeline: NLETimeline = {
      name: "Connected Gap Coverage",
      format: {
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
        audioRate: 48000,
      },
      assets: [
        {
          id: "r2",
          name: "main.mov",
          path: "/media/main.mov",
          duration: frames(600),
          hasVideo: true,
          hasAudio: true,
          audioChannels: 2,
          audioRate: 48000,
          timecodeStart: ZERO,
        },
        {
          id: "r3",
          name: "overlay.mov",
          path: "/media/overlay.mov",
          duration: frames(600),
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
              name: "main",
              offset: ZERO,
              duration: frames(150),
              sourceIn: ZERO,
              sourceDuration: frames(150),
            },
          ],
        },
        {
          type: "video",
          clips: [
            {
              assetId: "r3",
              name: "LATE_OVERLAY_SENTINEL",
              offset: frames(210),
              duration: frames(60),
              sourceIn: ZERO,
              sourceDuration: frames(60),
              lane: 1,
            },
          ],
        },
      ],
    }

    const xml = writeFCPXML(timeline)
    expect(xml).toContain('name="LATE_OVERLAY_SENTINEL"')
  })

  it("percent-encodes reserved characters in asset file URLs", () => {
    const timeline: NLETimeline = {
      name: "FCPXML URL Encoding",
      format: {
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
        audioRate: 48000,
      },
      assets: [
        {
          id: "r-url-fcpx",
          name: "shot #1?.mov",
          path: "/Volumes/Media Drive/shot #1?.mov",
          duration: frames(300),
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
              assetId: "r-url-fcpx",
              name: "url-test",
              offset: ZERO,
              duration: frames(120),
              sourceIn: ZERO,
              sourceDuration: frames(120),
            },
          ],
        },
      ],
    }

    const xml = writeFCPXML(timeline)
    expect(xml).toContain(
      'src="file:///Volumes/Media%20Drive/shot%20%231%3F.mov"',
    )
  })
})

describe("known gaps: xmeml export", () => {
  it("exports clipitems for explicit audio tracks even when no video tracks exist", () => {
    const timeline: NLETimeline = {
      name: "Audio Only XMEML",
      format: {
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
        audioRate: 48000,
      },
      assets: [
        {
          id: "r-a1",
          name: "music.wav",
          path: "/audio/music.wav",
          duration: frames(600),
          hasVideo: false,
          hasAudio: true,
          audioChannels: 2,
          audioRate: 48000,
          timecodeStart: ZERO,
        },
      ],
      tracks: [
        {
          type: "audio",
          clips: [
            {
              assetId: "r-a1",
              name: "AUDIO_TRACK_SENTINEL",
              offset: ZERO,
              duration: frames(120),
              sourceIn: ZERO,
              sourceDuration: frames(120),
            },
          ],
        },
      ],
    }

    const xml = writeXMEML(timeline)
    expect(xml).toContain("AUDIO_TRACK_SENTINEL")
  })

  it("preserves source track indexes for secondary video tracks", () => {
    const timeline: NLETimeline = {
      name: "Track Index Coverage",
      format: {
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
        audioRate: 48000,
      },
      assets: [
        {
          id: "r-v1",
          name: "v1.mov",
          path: "/video/v1.mov",
          duration: frames(600),
          hasVideo: true,
          hasAudio: true,
          audioChannels: 2,
          audioRate: 48000,
          timecodeStart: ZERO,
        },
        {
          id: "r-v2",
          name: "v2.mov",
          path: "/video/v2.mov",
          duration: frames(600),
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
              assetId: "r-v1",
              name: "v1",
              offset: ZERO,
              duration: frames(120),
              sourceIn: ZERO,
              sourceDuration: frames(120),
            },
          ],
        },
        {
          type: "video",
          clips: [
            {
              assetId: "r-v2",
              name: "v2",
              offset: ZERO,
              duration: frames(120),
              sourceIn: ZERO,
              sourceDuration: frames(120),
            },
          ],
        },
      ],
    }

    const xml = writeXMEML(timeline)
    expect(xml).toContain("<trackindex>2</trackindex>")
  })

  it("percent-encodes reserved characters in pathurl", () => {
    const timeline: NLETimeline = {
      name: "XMEML URL Encoding",
      format: {
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
        audioRate: 48000,
      },
      assets: [
        {
          id: "r-url-xmeml",
          name: "shot #1?.mov",
          path: "/Volumes/Media Drive/shot #1?.mov",
          duration: frames(300),
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
              assetId: "r-url-xmeml",
              name: "url-test",
              offset: ZERO,
              duration: frames(120),
              sourceIn: ZERO,
              sourceDuration: frames(120),
            },
          ],
        },
      ],
    }

    const xml = writeXMEML(timeline)
    expect(xml).toContain(
      "<pathurl>file:///Volumes/Media%20Drive/shot%20%231%3F.mov</pathurl>",
    )
  })
})

describe("known gaps: otio export", () => {
  it("percent-encodes target_url paths in media references", () => {
    const timeline: NLETimeline = {
      name: "OTIO URL Encoding",
      format: {
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
        audioRate: 48000,
      },
      assets: [
        {
          id: "r-url-1",
          name: "shot 01.mov",
          path: "/Volumes/Media Drive/shot 01.mov",
          duration: frames(300),
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
              assetId: "r-url-1",
              name: "url-test",
              offset: ZERO,
              duration: frames(120),
              sourceIn: ZERO,
              sourceDuration: frames(120),
            },
          ],
        },
      ],
    }

    const otio = JSON.parse(writeOTIO(timeline))
    const targetUrl =
      otio.tracks.children[0].children[0].media_references.DEFAULT_MEDIA
        .target_url

    expect(targetUrl).toBe("file:///Volumes/Media%20Drive/shot%2001.mov")
  })

  it("percent-encodes reserved characters in target_url", () => {
    const timeline: NLETimeline = {
      name: "OTIO Reserved URL Encoding",
      format: {
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
        audioRate: 48000,
      },
      assets: [
        {
          id: "r-url-2",
          name: "shot #1?.mov",
          path: "/Volumes/Media Drive/shot #1?.mov",
          duration: frames(300),
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
              assetId: "r-url-2",
              name: "url-test",
              offset: ZERO,
              duration: frames(120),
              sourceIn: ZERO,
              sourceDuration: frames(120),
            },
          ],
        },
      ],
    }

    const otio = JSON.parse(writeOTIO(timeline))
    const targetUrl =
      otio.tracks.children[0].children[0].media_references.DEFAULT_MEDIA
        .target_url

    expect(targetUrl).toBe("file:///Volumes/Media%20Drive/shot%20%231%3F.mov")
  })
})
