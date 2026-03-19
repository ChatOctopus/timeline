import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Timeline } from "../src/types.js"
import { rational, ZERO } from "../src/time.js"

function makeTimeline(): Timeline {
  return {
    name: "CLI Test",
    format: {
      width: 1920,
      height: 1080,
      frameRate: rational(24, 1),
      audioRate: 48000,
    },
    tracks: [
      {
        kind: "video",
        items: [
          {
            kind: "clip",
            name: "clip",
            mediaReference: {
              type: "external",
              name: "clip.mp4",
              targetUrl: "file:///media/clip.mp4",
              mediaKind: "video",
              availableRange: {
                startTime: ZERO,
                duration: rational(240, 24),
              },
              streamInfo: {
                hasVideo: true,
                hasAudio: true,
                width: 1920,
                height: 1080,
                frameRate: rational(24, 1),
                audioRate: 48000,
                audioChannels: 2,
              },
            },
            sourceRange: {
              startTime: ZERO,
              duration: rational(120, 24),
            },
          },
        ],
      },
    ],
  }
}

function makeIo() {
  const stdout: string[] = []
  const stderr: string[] = []

  return {
    io: {
      stdout(message: string) {
        stdout.push(message)
      },
      stderr(message: string) {
        stderr.push(message)
      },
    },
    stdout,
    stderr,
  }
}

describe("runCli", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("prints top-level help", async () => {
    const { runCli } = await import("../src/cli.js")
    const { io, stdout, stderr } = makeIo()

    const exitCode = await runCli([], io)

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("Usage:")
    expect(stderr).toEqual([])
  })

  it("forwards import and export warnings during convert", async () => {
    const readFile = vi.fn().mockResolvedValue("<input/>")
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const importTimeline = vi.fn().mockReturnValue({
      timeline: makeTimeline(),
      warnings: ["Import warning"],
    })
    const exportTimeline = vi.fn((_timeline, _editor, options) => {
      options?.onWarning?.("Export warning")
      return "<converted/>"
    })

    vi.doMock("node:fs/promises", () => ({
      readFile,
      writeFile,
    }))
    vi.doMock("../src/index.js", () => ({
      importTimeline,
      exportTimeline,
    }))

    const { runCli } = await import("../src/cli.js")
    const { io, stdout, stderr } = makeIo()

    const exitCode = await runCli(
      ["convert", "/tmp/in.fcpxml", "--to", "premiere", "--out", "/tmp/out.xml"],
      io,
    )

    expect(exitCode).toBe(0)
    expect(readFile).toHaveBeenCalledWith("/tmp/in.fcpxml", "utf-8")
    expect(writeFile).toHaveBeenCalledWith("/tmp/out.xml", "<converted/>", "utf-8")
    expect(stderr.join("")).toContain("[warning] Import warning")
    expect(stderr.join("")).toContain("[warning] Export warning")
    expect(stdout.join("")).toContain("Converted /tmp/in.fcpxml -> /tmp/out.xml (premiere)")
  })

  it("emits JSON validation output", async () => {
    const readFile = vi.fn().mockResolvedValue("<input/>")
    const importTimeline = vi.fn().mockReturnValue({
      timeline: makeTimeline(),
      warnings: ["Parser warning"],
    })
    const validateTimeline = vi.fn().mockReturnValue([
      {
        type: "warning",
        message: "Frame alignment warning",
      },
    ])
    const hasErrors = vi.fn().mockReturnValue(false)

    vi.doMock("node:fs/promises", () => ({
      readFile,
      writeFile: vi.fn(),
    }))
    vi.doMock("../src/index.js", () => ({
      importTimeline,
      exportTimeline: vi.fn(),
    }))
    vi.doMock("../src/validate.js", () => ({
      validateTimeline,
      hasErrors,
    }))

    const { runCli } = await import("../src/cli.js")
    const { io, stdout } = makeIo()

    const exitCode = await runCli(["validate", "/tmp/in.otio", "--json"], io)
    const report = JSON.parse(stdout.join(""))

    expect(exitCode).toBe(0)
    expect(readFile).toHaveBeenCalledWith("/tmp/in.otio", "utf-8")
    expect(report).toMatchObject({
      file: "/tmp/in.otio",
      timeline: "CLI Test",
      valid: true,
      errors: [],
      warnings: ["Import: Parser warning", "Frame alignment warning"],
    })
  })
})
