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

describe("probeAsset", () => {
  beforeEach(() => {
    execMock.mockReset()
  })

  it("maps ffprobe metadata into an NLE asset", async () => {
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

    const { probeAsset } = await import("../src/probe.js")
    const asset = await probeAsset("/media/interview.mov")

    expect(asset.name).toBe("interview.mov")
    expect(asset.path).toBe("/media/interview.mov")
    expect(asset.hasVideo).toBe(true)
    expect(asset.hasAudio).toBe(true)
    expect(asset.videoFormat?.width).toBe(3840)
    expect(asset.videoFormat?.height).toBe(2160)
    expect(asset.videoFormat?.frameRate).toEqual(rational(30000, 1001))
    expect(asset.audioChannels).toBe(2)
    expect(asset.audioRate).toBe(48000)
    expect(toSeconds(asset.timecodeStart!)).toBeCloseTo(3600, 1)
  })

  it("falls back cleanly for audio-only assets", async () => {
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

    const { probeAsset } = await import("../src/probe.js")
    const asset = await probeAsset("/audio/voiceover.wav")

    expect(asset.hasVideo).toBe(false)
    expect(asset.hasAudio).toBe(true)
    expect(asset.videoFormat).toBeUndefined()
    expect(asset.audioChannels).toBe(1)
    expect(asset.audioRate).toBe(44100)
    expect(asset.duration).toEqual(rational(60, 24))
  })
})
