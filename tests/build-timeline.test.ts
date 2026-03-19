import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ExternalReference } from "../src/types.js"
import { rational, ZERO, toSeconds } from "../src/time.js"

function makeReference(
  path: string,
  frameRate = rational(30000, 1001),
  durationFrames = 300,
): ExternalReference {
  return {
    type: "external",
    name: path.split("/").pop() ?? path,
    targetUrl: `file://${path}`,
    mediaKind: "video",
    availableRange: {
      startTime: ZERO,
      duration: rational(durationFrames * frameRate.den, frameRate.num),
    },
    streamInfo: {
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
      frameRate,
      audioRate: 48000,
      audioChannels: 2,
    },
  }
}

describe("createTimeline", () => {
  it("applies sensible defaults for synthetic timelines", async () => {
    const { createTimeline } = await import("../src/index.js")

    const timeline = createTimeline({
      name: "Slideshow",
      tracks: [
        {
          kind: "video",
          items: [
            {
              kind: "clip",
              name: "slide-1",
              mediaReference: {
                type: "external",
                targetUrl: "file:///slides/slide-1.png",
                mediaKind: "image",
              },
              sourceRange: {
                startTime: ZERO,
                duration: rational(72, 24),
              },
            },
          ],
        },
      ],
      metadata: {
        project: "demo",
      },
    })

    expect(timeline.name).toBe("Slideshow")
    expect(timeline.format.width).toBe(1920)
    expect(timeline.format.height).toBe(1080)
    expect(timeline.format.frameRate).toEqual(rational(24, 1))
    expect(timeline.format.audioRate).toBe(48000)
    expect(timeline.metadata).toEqual({ project: "demo" })
    expect(timeline.tracks[0].items[0].kind).toBe("clip")
  })
})

describe("buildTimelineFromFiles", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("rejects negative trim values", async () => {
    vi.doMock("../src/probe.js", () => ({
      probeMediaReference: vi.fn().mockResolvedValue(makeReference("/media/clip.mp4")),
    }))

    const { buildTimelineFromFiles } = await import("../src/index.js")

    await expect(
      buildTimelineFromFiles("Bad Trim", [{ path: "/media/clip.mp4", startAt: -1 }]),
    ).rejects.toThrow("startAt cannot be negative")

    await expect(
      buildTimelineFromFiles("Bad Trim", [{ path: "/media/clip.mp4", duration: -1 }]),
    ).rejects.toThrow("duration cannot be negative")
  })

  it("returns the core timeline model with inline media references", async () => {
    vi.doMock("../src/probe.js", () => ({
      probeMediaReference: vi.fn().mockResolvedValue(makeReference("/media/clip.mp4")),
    }))

    const { buildTimelineFromFiles } = await import("../src/index.js")
    const timeline = await buildTimelineFromFiles("Zero Trim", [
      { path: "/media/clip.mp4", startAt: 0, duration: 0 },
    ])

    expect(timeline.tracks[0].kind).toBe("video")
    expect(timeline.tracks[0].items).toHaveLength(1)

    const clip = timeline.tracks[0].items[0]
    expect(clip.kind).toBe("clip")
    if (clip.kind !== "clip") {
      throw new Error("expected clip")
    }

    expect(clip.mediaReference.type).toBe("external")
    if (clip.mediaReference.type !== "external") {
      throw new Error("expected external reference")
    }

    expect(clip.mediaReference.targetUrl).toBe("file:///media/clip.mp4")
    expect(toSeconds(clip.sourceRange?.startTime ?? ZERO)).toBe(0)
    expect(toSeconds(clip.sourceRange?.duration ?? ZERO)).toBe(0)
  })

  it("rejects mixed-rate trim durations that cannot roundtrip cleanly", async () => {
    vi.doMock("../src/probe.js", () => ({
      probeMediaReference: vi
        .fn()
        .mockImplementation(async (path: string) =>
          path.includes("timeline")
            ? makeReference(path, rational(30000, 1001), 300)
            : makeReference(path, rational(24000, 1001), 240),
        ),
    }))

    const { buildTimelineFromFiles } = await import("../src/index.js")

    await expect(
      buildTimelineFromFiles("Mixed Rates", [
        { path: "/media/timeline.mp4" },
        { path: "/media/source24.mp4", duration: 0.1 },
      ]),
    ).rejects.toThrow("cannot be represented consistently")
  })

  it("requires explicit duration for still images", async () => {
    vi.doMock("../src/probe.js", () => ({
      probeMediaReference: vi.fn().mockResolvedValue({
        type: "external",
        name: "slide.png",
        targetUrl: "file:///slides/slide.png",
        mediaKind: "image",
        streamInfo: {
          width: 1920,
          height: 1080,
        },
      }),
    }))

    const { buildTimelineFromFiles } = await import("../src/index.js")

    await expect(
      buildTimelineFromFiles("Slides", [{ path: "/slides/slide.png" }]),
    ).rejects.toThrow("still images require an explicit duration")
  })
})
