import { describe, expect, it } from "vitest"
import { computeTimelineDuration, rational, toSeconds, validateTimeline, ZERO } from "../src/index.js"
import type { Timeline } from "../src/types.js"

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    name: "Core Timeline",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(24, 1),
      audioRate: 48000,
      colorSpace: "1-1-1 (Rec. 709)",
    },
    tracks: [
      {
        kind: "video",
        items: [
          {
            kind: "clip",
            name: "clip-1",
            mediaReference: {
              type: "external",
              name: "clip-1.mov",
              targetUrl: "file:///media/clip-1.mov",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(10, 1),
              },
            },
            sourceRange: {
              startTime: ZERO,
              duration: rational(3, 1),
            },
          },
          {
            kind: "gap",
            sourceRange: {
              startTime: ZERO,
              duration: rational(1, 1),
            },
          },
          {
            kind: "clip",
            name: "clip-2",
            mediaReference: {
              type: "external",
              name: "clip-2.mov",
              targetUrl: "file:///media/clip-2.mov",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(10, 1),
              },
            },
            sourceRange: {
              startTime: ZERO,
              duration: rational(3, 1),
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("OTIO-first core model", () => {
  it("computes duration from explicit clip and gap items", () => {
    const timeline = makeTimeline()
    expect(toSeconds(computeTimelineDuration(timeline))).toBe(7)
  })

  it("treats transitions as overlap items with no standalone duration", () => {
    const timeline = makeTimeline({
      tracks: [
        {
          kind: "video",
          items: [
            {
              kind: "clip",
              name: "clip-1",
              mediaReference: {
                type: "external",
                targetUrl: "file:///media/clip-1.mov",
                mediaKind: "video",
              },
              sourceRange: {
                startTime: ZERO,
                duration: rational(2, 1),
              },
            },
            {
              kind: "transition",
              name: "cross-dissolve",
              transitionType: "SMPTE_Dissolve",
              inOffset: rational(12, 24),
              outOffset: rational(12, 24),
            },
            {
              kind: "clip",
              name: "clip-2",
              mediaReference: {
                type: "external",
                targetUrl: "file:///media/clip-2.mov",
                mediaKind: "video",
              },
              sourceRange: {
                startTime: ZERO,
                duration: rational(2, 1),
              },
            },
          ],
        },
      ],
    })

    expect(toSeconds(computeTimelineDuration(timeline))).toBe(3)
  })

  it("rejects transitions at track edges", () => {
    const timeline = makeTimeline({
      tracks: [
        {
          kind: "video",
          items: [
            {
              kind: "transition",
              name: "dangling",
              inOffset: rational(12, 24),
              outOffset: rational(12, 24),
            },
            {
              kind: "clip",
              name: "clip-1",
              mediaReference: {
                type: "external",
                targetUrl: "file:///media/clip-1.mov",
                mediaKind: "video",
              },
              sourceRange: {
                startTime: ZERO,
                duration: rational(2, 1),
              },
            },
          ],
        },
      ],
    })

    expect(validateTimeline(timeline)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: 'Transition "dangling" must sit between two composable items',
        }),
      ]),
    )
  })

  it("validates that external references require a target URL", () => {
    const timeline = makeTimeline({
      tracks: [
        {
          kind: "video",
          items: [
            {
              kind: "clip",
              name: "broken-clip",
              mediaReference: {
                type: "external",
                targetUrl: "",
                mediaKind: "video",
              },
              sourceRange: {
                startTime: ZERO,
                duration: rational(2, 1),
              },
            },
          ],
        },
      ],
    })

    expect(validateTimeline(timeline)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: 'Clip "broken-clip" has an external reference without a targetUrl',
        }),
      ]),
    )
  })
})
