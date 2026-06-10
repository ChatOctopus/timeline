import type { NLEFormat } from "./types.js"
import { rational } from "./time.js"

export const DEFAULT_AUDIO_CHANNELS = 2
export const DEFAULT_AUDIO_LAYOUT = "stereo"

export const DEFAULT_FORMAT: Readonly<NLEFormat> = Object.freeze({
  width: 1920,
  height: 1080,
  frameRate: rational(24, 1),
  audioRate: 48000,
})

export function resolveFormatDefaults(format?: Partial<NLEFormat>): NLEFormat {
  // Explicitly-undefined keys must fall back to defaults, not override them
  const overrides = format ? structuredClone(format) : {}
  for (const key of Object.keys(overrides) as (keyof NLEFormat)[]) {
    if (overrides[key] === undefined) delete overrides[key]
  }

  return { ...DEFAULT_FORMAT, ...overrides }
}
