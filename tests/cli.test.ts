import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { isDirectRunInvocation, runCli } from "../src/cli.js"
import { exportTimeline, rational, ZERO } from "../src/index.js"
import type { NLETimeline } from "../src/types.js"

function makeTimeline(): NLETimeline {
  return {
    name: "CLI Test",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(24000, 1001),
      audioRate: 48000,
      colorSpace: "1-1-1 (Rec. 709)",
    },
    assets: [
      {
        id: "r2",
        name: "scene1.mov",
        path: "/media/scene1.mov",
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
            name: "scene1",
            offset: ZERO,
            duration: rational(120 * 1001, 24000),
            sourceIn: ZERO,
            sourceDuration: rational(120 * 1001, 24000),
          },
        ],
      },
    ],
  }
}

function captureIO() {
  let stdout = ""
  let stderr = ""

  return {
    io: {
      stdout(message: string) {
        stdout += message
      },
      stderr(message: string) {
        stderr += message
      },
    },
    stdout() {
      return stdout
    },
    stderr() {
      return stderr
    },
  }
}

async function withTempDir(
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "timeline-cli-"))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("CLI", () => {
  it("recognizes symlinked argv entries as direct execution", async () => {
    await withTempDir(async (dir) => {
      const targetPath = join(dir, "entry.js")
      const symlinkPath = join(dir, "timeline")
      await writeFile(targetPath, "", "utf-8")
      await symlink(targetPath, symlinkPath)

      expect(
        isDirectRunInvocation(symlinkPath, pathToFileURL(targetPath).href),
      ).toBe(true)
    })
  })

  it("converts timeline files with --out", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "project.fcpxml")
      const outputPath = join(dir, "project.otio")
      await writeFile(inputPath, exportTimeline(makeTimeline(), "fcpx"), "utf-8")

      const output = captureIO()
      const exitCode = await runCli(
        ["convert", inputPath, "--to", "otio", "--out", outputPath],
        output.io,
      )

      expect(exitCode).toBe(0)
      expect(output.stderr()).toBe("")
      expect(output.stdout()).toContain(`Converted ${inputPath} -> ${outputPath}`)

      const written = await readFile(outputPath, "utf-8")
      expect(written).toContain('"OTIO_SCHEMA": "Timeline.1"')
    })
  })

  it("returns an error when convert is missing --to", async () => {
    const output = captureIO()
    const exitCode = await runCli(["convert", "./edit.fcpxml"], output.io)

    expect(exitCode).toBe(1)
    expect(output.stderr()).toContain("convert requires --to")
  })

  it("passes validation for a valid timeline", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "project.xml")
      await writeFile(inputPath, exportTimeline(makeTimeline(), "premiere"), "utf-8")

      const output = captureIO()
      const exitCode = await runCli(["validate", inputPath], output.io)

      expect(exitCode).toBe(0)
      expect(output.stdout()).toContain("Validation passed")
      expect(output.stderr()).toBe("")
    })
  })

  it("emits validation errors as JSON", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "invalid.otio")
      const parsedOtio = JSON.parse(exportTimeline(makeTimeline(), "otio"))
      parsedOtio.metadata["@chatoctopus/timeline"].format.width = 0
      await writeFile(inputPath, JSON.stringify(parsedOtio, null, 2), "utf-8")

      const output = captureIO()
      const exitCode = await runCli(["validate", inputPath, "--json"], output.io)

      expect(exitCode).toBe(1)
      expect(output.stderr()).toBe("")

      const report = JSON.parse(output.stdout()) as {
        valid: boolean
        errors: string[]
      }

      expect(report.valid).toBe(false)
      expect(
        report.errors.some((message) => message.includes("Invalid dimensions")),
      ).toBe(true)
    })
  })
})
