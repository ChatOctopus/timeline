import type { Rational } from "./types.js"

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b !== 0) {
    ;[a, b] = [b, a % b]
  }
  return a
}

function simplify(r: Rational): Rational {
  if (r.num === 0) return { num: 0, den: 1 }
  const d = gcd(r.num, r.den)
  return { num: r.num / d, den: r.den / d }
}

export function rational(num: number, den: number): Rational {
  if (den === 0) throw new Error("Rational denominator cannot be zero")
  if (den < 0) {
    num = -num
    den = -den
  }
  return simplify({ num, den })
}

export const ZERO: Rational = { num: 0, den: 1 }

export function isZero(r: Rational): boolean {
  return r.num === 0
}

export function add(a: Rational, b: Rational): Rational {
  if (a.num === 0) return b
  if (b.num === 0) return a
  return simplify({
    num: a.num * b.den + b.num * a.den,
    den: a.den * b.den,
  })
}

export function subtract(a: Rational, b: Rational): Rational {
  if (b.num === 0) return a
  const result = simplify({
    num: a.num * b.den - b.num * a.den,
    den: a.den * b.den,
  })
  if (result.num < 0) return ZERO
  return result
}

/**
 * Subtract two rationals without clamping to zero.
 * Use when negative results are meaningful (e.g. normalizing timecodeStart).
 */
export function subtractUnclamped(a: Rational, b: Rational): Rational {
  if (b.num === 0) return a
  return simplify({
    num: a.num * b.den - b.num * a.den,
    den: a.den * b.den,
  })
}

export function multiply(a: Rational, b: Rational): Rational {
  return simplify({ num: a.num * b.num, den: a.den * b.den })
}

export function divide(a: Rational, b: Rational): Rational {
  if (b.num === 0) throw new Error("Division by zero")
  return simplify({ num: a.num * b.den, den: a.den * b.num })
}

export function toSeconds(r: Rational): number {
  return r.num / r.den
}

/**
 * Convert to FCP time string format: "num/dens" (e.g., "240240/24000s").
 * Zero is represented as "0s".
 */
export function toFCPString(r: Rational): string {
  if (r.num === 0) return "0s"
  return `${r.num}/${r.den}s`
}

/**
 * Parse an FCP time string like "240240/24000s" or "0s" into a Rational.
 */
export function parseFCPString(s: string): Rational {
  if (s === "0s" || s === "0") return ZERO

  const intMatch = s.match(/^(\d+)s$/)
  if (intMatch) return rational(parseInt(intMatch[1], 10), 1)

  const fracMatch = s.match(/^(\d+)\/(\d+)s$/)
  if (fracMatch) {
    return rational(parseInt(fracMatch[1], 10), parseInt(fracMatch[2], 10))
  }

  throw new Error(`Invalid FCP time string: "${s}"`)
}

/**
 * Compute frame duration from frame rate.
 * e.g., frameRate 30000/1001 -> frameDuration 1001/30000
 */
export function frameDuration(frameRate: Rational): Rational {
  return rational(frameRate.den, frameRate.num)
}

/**
 * Convert seconds to a frame-aligned rational duration.
 * Snaps to the nearest frame boundary to prevent FCP "not on edit frame boundary" errors.
 * Ported from cutlass ConvertSecondsToFCPDuration + buttercut round_to_frame_boundary.
 */
export function secondsToFrameAligned(
  seconds: number,
  frameRate: Rational,
): Rational {
  const fps = frameRate.num / frameRate.den
  const exactFrames = seconds * fps
  const floorFrames = Math.floor(exactFrames)
  const ceilFrames = Math.ceil(exactFrames)

  const floorDuration = floorFrames / fps
  const ceilDuration = ceilFrames / fps

  const frames =
    Math.abs(seconds - floorDuration) <= Math.abs(seconds - ceilDuration)
      ? floorFrames
      : ceilFrames

  return rational(frames * frameRate.den, frameRate.num)
}

/**
 * Round a rational time value to the nearest frame boundary.
 */
export function roundToFrameBoundary(
  time: Rational,
  frameRate: Rational,
): Rational {
  return secondsToFrameAligned(toSeconds(time), frameRate)
}

/**
 * Convert a rational duration to frame count.
 * Used by xmeml which expresses timing in frames, not fractions.
 */
export function toFrames(duration: Rational, frameDur: Rational): number {
  return Math.round(
    (duration.num * frameDur.den) / (duration.den * frameDur.num),
  )
}

/**
 * Get the nominal (integer) frame rate, e.g., 30000/1001 -> 30.
 */
export function nominalFrameRate(frameRate: Rational): number {
  return Math.round(frameRate.num / frameRate.den)
}

/**
 * Detect if a frame rate is NTSC (uses 1001 denominator).
 */
export function isNTSC(frameRate: Rational): boolean {
  return frameRate.den === 1001
}

/**
 * Detect if a frame rate is drop-frame (29.97 or 59.94).
 */
export function isDropFrame(frameRate: Rational): boolean {
  return (
    (frameRate.num === 30000 && frameRate.den === 1001) ||
    (frameRate.num === 60000 && frameRate.den === 1001)
  )
}

/**
 * Parse SMPTE timecode string (HH:MM:SS:FF or HH:MM:SS;FF) into a Rational.
 * Handles drop-frame timecode (semicolon separator).
 * Ported from buttercut clip_timecode_fraction.
 */
export function parseTimecode(tc: string, frameRate: Rational): Rational {
  if (!tc || tc.trim() === "") return ZERO

  const isDF = tc.includes(";")
  const parts = tc.trim().replace(/;/g, ":").split(":").map(Number)
  if (parts.length !== 4) return ZERO

  const [hours, minutes, seconds, frames] = parts
  const fpsNominal = nominalFrameRate(frameRate)
  if (fpsNominal <= 0) return ZERO

  let totalFrames: number
  if (isDF && isDropFrame(frameRate)) {
    const dropFramesPerMinute = fpsNominal === 60 ? 4 : 2
    const totalMinutes = hours * 60 + minutes
    const droppedFrames =
      dropFramesPerMinute * (totalMinutes - Math.floor(totalMinutes / 10))
    totalFrames =
      (hours * 3600 + minutes * 60 + seconds) * fpsNominal +
      frames -
      droppedFrames
  } else {
    totalFrames = (hours * 3600 + minutes * 60 + seconds) * fpsNominal + frames
  }

  if (totalFrames < 0) return ZERO

  return rational(totalFrames * frameRate.den, frameRate.num)
}

/** Common frame rates */
export const FRAME_RATES = {
  "23.976": rational(24000, 1001),
  "24": rational(24, 1),
  "25": rational(25, 1),
  "29.97": rational(30000, 1001),
  "30": rational(30, 1),
  "50": rational(50, 1),
  "59.94": rational(60000, 1001),
  "60": rational(60, 1),
} as const
