import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NLEAsset } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeAsset(
  path: string,
  frameRate = rational(30000, 1001),
  durationFrames = 300,
): NLEAsset {
  return {
    id: `asset-${path}`,
    name: path.split("/").pop() ?? path,
    path,
    duration: rational(durationFrames * frameRate.den, frameRate.num),
    hasVideo: true,
    hasAudio: true,
    videoFormat: {
      width: 1920,
      height: 1080,
      frameRate,
      audioRate: 48000,
    },
    audioChannels: 2,
    audioRate: 48000,
    timecodeStart: ZERO,
  }
}

describe("buildTimeline", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("rejects negative trim values", async () => {
    vi.doMock("../src/probe.js", () => ({
      probeAsset: vi.fn().mockResolvedValue(makeAsset("/media/clip.mp4")),
    }))

    const { buildTimeline } = await import("../src/index.js")

    await expect(
      buildTimeline("Bad Trim", [{ path: "/media/clip.mp4", startAt: -1 }]),
    ).rejects.toThrow("startAt cannot be negative")

    await expect(
      buildTimeline("Bad Trim", [{ path: "/media/clip.mp4", duration: -1 }]),
    ).rejects.toThrow("duration cannot be negative")
  })

  it("treats explicit zero duration as a real trim value", async () => {
    vi.doMock("../src/probe.js", () => ({
      probeAsset: vi.fn().mockResolvedValue(makeAsset("/media/clip.mp4")),
    }))

    const { buildTimeline } = await import("../src/index.js")
    const timeline = await buildTimeline("Zero Trim", [
      { path: "/media/clip.mp4", startAt: 0, duration: 0 },
    ])

    const clip = timeline.tracks[0].clips[0]
    expect(toSeconds(clip.sourceIn)).toBe(0)
    expect(toSeconds(clip.duration)).toBe(0)
    expect(toSeconds(clip.sourceDuration)).toBe(0)
  })

  it("rejects mixed-rate trim durations that cannot roundtrip cleanly", async () => {
    vi.doMock("../src/probe.js", () => ({
      probeAsset: vi
        .fn()
        .mockImplementation(async (path: string) =>
          path.includes("timeline")
            ? makeAsset(path, rational(30000, 1001), 300)
            : makeAsset(path, rational(24000, 1001), 240),
        ),
    }))

    const { buildTimeline } = await import("../src/index.js")

    await expect(
      buildTimeline("Mixed Rates", [
        { path: "/media/timeline.mp4" },
        { path: "/media/source24.mp4", duration: 0.1 },
      ]),
    ).rejects.toThrow("cannot be represented consistently")
  })
})
