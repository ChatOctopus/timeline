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
  return {
    ...DEFAULT_FORMAT,
    ...(format ? structuredClone(format) : {}),
  }
}
