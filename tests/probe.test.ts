import { beforeEach, describe, expect, it, vi } from "vitest"
import { rational, toSeconds } from "../src/time.js"

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
}))

vi.mock("node:util", async () => {
  const actual = await vi.importActual<typeof import("node:util")>("node:util")
  return {
    ...actual,
    promisify: () => execMock,
  }
})

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}))

describe("probeMediaReference", () => {
  beforeEach(() => {
    execMock.mockReset()
  })

  it("maps ffprobe metadata into an external video reference", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify({
        streams: [
          {
            codec_type: "video",
            width: 3840,
            height: 2160,
            r_frame_rate: "30000/1001",
            color_space: "bt709",
            tags: { timecode: "01:00:00;00" },
          },
          {
            codec_type: "audio",
            sample_rate: "48000",
            channels: 2,
          },
        ],
        format: {
          duration: "10.01",
        },
      }),
    })

    const { probeMediaReference } = await import("../src/probe.js")
    const reference = await probeMediaReference("/media/interview.mov")

    expect(reference.type).toBe("external")
    expect(reference.name).toBe("interview.mov")
    expect(reference.targetUrl).toBe("file:///media/interview.mov")
    expect(reference.mediaKind).toBe("video")
    expect(toSeconds(reference.availableRange!.startTime)).toBeCloseTo(3600, 1)
    expect(reference.availableRange!.duration).toEqual(rational(300 * 1001, 30000))
    expect(reference.streamInfo).toMatchObject({
      hasVideo: true,
      hasAudio: true,
      width: 3840,
      height: 2160,
      frameRate: rational(30000, 1001),
      audioRate: 48000,
      audioChannels: 2,
      colorSpace: "1-1-1 (Rec. 709)",
    })
  })

  it("falls back cleanly for audio-only references", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify({
        streams: [
          {
            codec_type: "audio",
            sample_rate: "44100",
            channels: 1,
          },
        ],
        format: {
          duration: "2.5",
        },
      }),
    })

    const { probeMediaReference } = await import("../src/probe.js")
    const reference = await probeMediaReference("/audio/voiceover.wav")

    expect(reference.mediaKind).toBe("audio")
    expect(reference.availableRange!.duration).toEqual(rational(5, 2))
    expect(reference.streamInfo).toMatchObject({
      hasVideo: false,
      hasAudio: true,
      audioRate: 44100,
      audioChannels: 1,
    })
    expect(reference.streamInfo?.frameRate).toBeUndefined()
  })

  it("classifies still images and leaves intrinsic duration unset", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify({
        streams: [
          {
            codec_type: "video",
            width: 1920,
            height: 1080,
            color_space: "bt709",
          },
        ],
        format: {},
      }),
    })

    const { probeMediaReference } = await import("../src/probe.js")
    const reference = await probeMediaReference("/images/slide.png")

    expect(reference.mediaKind).toBe("image")
    expect(reference.targetUrl).toBe("file:///images/slide.png")
    expect(reference.availableRange).toBeUndefined()
    expect(reference.streamInfo).toMatchObject({
      width: 1920,
      height: 1080,
      colorSpace: "1-1-1 (Rec. 709)",
    })
  })
})
