import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { exportTimeline, importTimeline } from "../src/index.js"
import { computeTimelineDuration, hasErrors, validateTimeline } from "../src/validate.js"
import { toSeconds } from "../src/time.js"
import type { Timeline } from "../src/types.js"

const EDITORS = ["fcpx", "premiere", "resolve", "otio"] as const

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
const fixtures = readdirSync(fixturesDir)
  .filter((name) => /\.(fcpxml|xml|otio)$/.test(name))
  .sort()

function countClips(timeline: Timeline): number {
  return timeline.tracks
    .flatMap((track) => track.items)
    .filter((item) => item.kind === "clip").length
}

// Every project file in tests/fixtures/ is swept automatically.
// Drop in a real NLE export (sanitized media paths) to extend coverage.
describe("real-world fixtures", () => {
  it("has at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const name of fixtures) {
    describe(name, () => {
      const content = readFileSync(join(fixturesDir, name), "utf-8")

      it("imports without hard validation errors", () => {
        const { timeline } = importTimeline(content)
        expect(hasErrors(validateTimeline(timeline))).toBe(false)
      })

      it("exports to every format without corrupt values", () => {
        const { timeline } = importTimeline(content)

        for (const editor of EDITORS) {
          const output = exportTimeline(timeline, editor)
          expect(output, `${editor} output`).not.toContain("undefined")
          expect(output, `${editor} output`).not.toContain("NaN")
        }
      })

      it("preserves duration and clip count through FCPXML and OTIO roundtrips", () => {
        const original = importTimeline(content).timeline

        for (const editor of ["fcpx", "otio"] as const) {
          const roundtrip = importTimeline(exportTimeline(original, editor)).timeline
          expect(countClips(roundtrip), `${editor} clip count`).toBe(countClips(original))
          expect(
            toSeconds(computeTimelineDuration(roundtrip)),
            `${editor} duration`,
          ).toBeCloseTo(toSeconds(computeTimelineDuration(original)), 3)
        }
      })
    })
  }
})
