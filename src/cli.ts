#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { exportTimeline, importTimeline } from "./index.js"
import type { NLEEditor } from "./types.js"
import { hasErrors, validateTimeline } from "./validate.js"

interface CliIO {
  stdout: (message: string) => void
  stderr: (message: string) => void
}

interface OptionSpec {
  key: string
  short: string
  hasValue: boolean
}

interface ParsedOptions {
  positionals: string[]
  options: Record<string, string | boolean>
  unknown: string[]
  missingValue: string[]
  unexpectedValue: string[]
}

const HELP_TEXT = `Usage:
  timeline <command> [options]

Commands:
  convert <input> --to <fcpx|premiere|resolve|otio> [--out <path>]
  validate <input> [--json]

Examples:
  timeline convert ./edit.fcpxml --to otio --out ./edit.otio
  timeline validate ./edit.xml
  timeline validate ./edit.otio --json
`

const CONVERT_HELP = `Usage:
  timeline convert <input> --to <fcpx|premiere|resolve|otio> [--out <path>]

Options:
  -t, --to    Target editor format
  -o, --out   Output file path (prints to stdout if omitted)
  -h, --help  Show this help
`

const VALIDATE_HELP = `Usage:
  timeline validate <input> [--json]

Options:
  -j, --json  Emit machine-readable JSON
  -h, --help  Show this help
`

const EDITORS: NLEEditor[] = ["fcpx", "premiere", "resolve", "otio"]

const DEFAULT_IO: CliIO = {
  stdout(message: string) {
    process.stdout.write(message)
  },
  stderr(message: string) {
    process.stderr.write(message)
  },
}

function parseOptions(argv: string[], specs: OptionSpec[]): ParsedOptions {
  const byLong = new Map(specs.map((spec) => [spec.key, spec]))
  const byShort = new Map(specs.map((spec) => [spec.short, spec]))

  const positionals: string[] = []
  const options: Record<string, string | boolean> = {}
  const unknown: string[] = []
  const missingValue: string[] = []
  const unexpectedValue: string[] = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === "--") {
      positionals.push(...argv.slice(i + 1))
      break
    }

    if (arg.startsWith("--")) {
      const optionWithValue = arg.slice(2)
      const equalsIndex = optionWithValue.indexOf("=")
      const key =
        equalsIndex === -1
          ? optionWithValue
          : optionWithValue.slice(0, equalsIndex)
      const inlineValue =
        equalsIndex === -1
          ? undefined
          : optionWithValue.slice(equalsIndex + 1)

      const spec = byLong.get(key)
      if (!spec) {
        unknown.push(`--${key}`)
        continue
      }

      if (spec.hasValue) {
        if (inlineValue !== undefined && inlineValue !== "") {
          options[spec.key] = inlineValue
          continue
        }

        const next = argv[i + 1]
        if (!next || next.startsWith("-")) {
          missingValue.push(spec.key)
          continue
        }

        options[spec.key] = next
        i += 1
        continue
      }

      if (inlineValue !== undefined) {
        unexpectedValue.push(spec.key)
      } else {
        options[spec.key] = true
      }
      continue
    }

    if (arg.startsWith("-") && arg !== "-") {
      if (arg.length !== 2) {
        unknown.push(arg)
        continue
      }

      const short = arg.slice(1)
      const spec = byShort.get(short)
      if (!spec) {
        unknown.push(arg)
        continue
      }

      if (spec.hasValue) {
        const next = argv[i + 1]
        if (!next || next.startsWith("-")) {
          missingValue.push(spec.key)
          continue
        }

        options[spec.key] = next
        i += 1
      } else {
        options[spec.key] = true
      }
      continue
    }

    positionals.push(arg)
  }

  return {
    positionals,
    options,
    unknown,
    missingValue,
    unexpectedValue,
  }
}

function assertNoParseErrors(parsed: ParsedOptions): void {
  if (parsed.unknown.length > 0) {
    throw new Error(`Unknown option(s): ${parsed.unknown.join(", ")}`)
  }

  if (parsed.missingValue.length > 0) {
    const names = parsed.missingValue.map((name) => `--${name}`).join(", ")
    throw new Error(`Missing value for option(s): ${names}`)
  }

  if (parsed.unexpectedValue.length > 0) {
    const names = parsed.unexpectedValue.map((name) => `--${name}`).join(", ")
    throw new Error(`Option(s) do not accept a value: ${names}`)
  }
}

function isEditor(value: string): value is NLEEditor {
  return EDITORS.includes(value as NLEEditor)
}

async function runConvert(argv: string[], io: CliIO): Promise<number> {
  const parsed = parseOptions(argv, [
    { key: "to", short: "t", hasValue: true },
    { key: "out", short: "o", hasValue: true },
    { key: "help", short: "h", hasValue: false },
  ])

  if (parsed.options.help === true) {
    io.stdout(CONVERT_HELP)
    return 0
  }

  assertNoParseErrors(parsed)

  if (parsed.positionals.length !== 1) {
    throw new Error("convert expects exactly one input file")
  }

  const to = parsed.options.to
  if (typeof to !== "string" || to.trim() === "") {
    throw new Error("convert requires --to <fcpx|premiere|resolve|otio>")
  }

  if (!isEditor(to)) {
    throw new Error(
      `Unsupported editor "${to}". Expected one of: ${EDITORS.join(", ")}`,
    )
  }

  const outPath = parsed.options.out
  if (outPath !== undefined && typeof outPath !== "string") {
    throw new Error("--out requires a file path")
  }

  const inputPath = parsed.positionals[0]
  const inputContent = await readFile(inputPath, "utf-8")
  const { timeline, warnings } = importTimeline(inputContent)

  for (const warning of warnings) {
    io.stderr(`[warning] ${warning}\n`)
  }

  const converted = exportTimeline(timeline, to)

  if (outPath) {
    await writeFile(outPath, converted, "utf-8")
    io.stdout(`Converted ${inputPath} -> ${outPath} (${to})\n`)
  } else {
    io.stdout(converted)
  }

  return 0
}

async function runValidate(argv: string[], io: CliIO): Promise<number> {
  const parsed = parseOptions(argv, [
    { key: "json", short: "j", hasValue: false },
    { key: "help", short: "h", hasValue: false },
  ])

  if (parsed.options.help === true) {
    io.stdout(VALIDATE_HELP)
    return 0
  }

  assertNoParseErrors(parsed)

  if (parsed.positionals.length !== 1) {
    throw new Error("validate expects exactly one input file")
  }

  const inputPath = parsed.positionals[0]
  const inputContent = await readFile(inputPath, "utf-8")
  const { timeline, warnings: importWarnings } = importTimeline(inputContent)
  const validationResults = validateTimeline(timeline)
  const errors = validationResults.filter((result) => result.type === "error")
  const validationWarnings = validationResults
    .filter((result) => result.type === "warning")
    .map((result) => result.message)
  const warnings = [
    ...importWarnings.map((warning) => `Import: ${warning}`),
    ...validationWarnings,
  ]

  if (parsed.options.json === true) {
    io.stdout(
      JSON.stringify(
        {
          file: inputPath,
          timeline: timeline.name,
          valid: !hasErrors(validationResults),
          errors: errors.map((error) => error.message),
          warnings,
        },
        null,
        2,
      ) + "\n",
    )
  } else {
    const failed = errors.length > 0
    const summary = `Validation ${failed ? "failed" : "passed"} for "${timeline.name}" (${errors.length} errors, ${warnings.length} warnings)\n`
    ;(failed ? io.stderr : io.stdout)(summary)

    for (const error of errors) {
      io.stderr(`[error] ${error.message}\n`)
    }

    for (const warning of warnings) {
      io.stderr(`[warning] ${warning}\n`)
    }
  }

  return errors.length === 0 ? 0 : 1
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function resolveRealPath(pathLike: string): string {
  try {
    return realpathSync(pathLike)
  } catch {
    return resolve(pathLike)
  }
}

export async function runCli(argv: string[], io: CliIO = DEFAULT_IO): Promise<number> {
  const [command, ...rest] = argv

  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.stdout(HELP_TEXT)
    return 0
  }

  try {
    switch (command) {
      case "convert":
        return await runConvert(rest, io)
      case "validate":
        return await runValidate(rest, io)
      default:
        throw new Error(
          `Unknown command "${command}". Supported commands: convert, validate`,
        )
    }
  } catch (error) {
    io.stderr(`Error: ${errorMessage(error)}\n`)
    return 1
  }
}

export function isDirectRunInvocation(
  argvEntry: string | undefined,
  moduleUrl: string,
): boolean {
  if (!argvEntry) return false

  const entryPath = resolveRealPath(argvEntry)
  const modulePath = resolveRealPath(fileURLToPath(moduleUrl))
  return entryPath === modulePath
}

function isDirectRun(): boolean {
  return isDirectRunInvocation(process.argv[1], import.meta.url)
}

if (isDirectRun()) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}
