import { describe, it, expect } from "vitest"
import {
  rational,
  ZERO,
  isZero,
  add,
  subtract,
  subtractUnclamped,
  multiply,
  divide,
  toSeconds,
  toFCPString,
  parseFCPString,
  frameDuration,
  secondsToFrameAligned,
  roundToFrameBoundary,
  toFrames,
  nominalFrameRate,
  isNTSC,
  isDropFrame,
  parseTimecode,
  FRAME_RATES,
} from "../src/time.js"

describe("rational", () => {
  it("simplifies fractions", () => {
    const r = rational(4, 8)
    expect(r).toEqual({ num: 1, den: 2 })
  })

  it("handles zero numerator", () => {
    expect(rational(0, 5)).toEqual({ num: 0, den: 1 })
  })

  it("normalizes negative denominator", () => {
    const r = rational(3, -4)
    expect(r).toEqual({ num: -3, den: 4 })
  })

  it("throws on zero denominator", () => {
    expect(() => rational(1, 0)).toThrow("denominator cannot be zero")
  })
})

describe("arithmetic", () => {
  it("adds fractions", () => {
    const a = rational(1, 3)
    const b = rational(1, 6)
    const result = add(a, b)
    expect(result).toEqual({ num: 1, den: 2 })
  })

  it("adds with zero", () => {
    const a = rational(5, 7)
    expect(add(a, ZERO)).toEqual(a)
    expect(add(ZERO, a)).toEqual(a)
  })

  it("subtracts fractions", () => {
    const a = rational(3, 4)
    const b = rational(1, 4)
    expect(subtract(a, b)).toEqual({ num: 1, den: 2 })
  })

  it("subtract clamps to zero", () => {
    const a = rational(1, 4)
    const b = rational(3, 4)
    expect(subtract(a, b)).toEqual(ZERO)
  })

  it("subtractUnclamped allows negative results", () => {
    const a = rational(1, 4)
    const b = rational(3, 4)
    const result = subtractUnclamped(a, b)
    expect(result).toEqual({ num: -1, den: 2 })
    expect(toSeconds(result)).toBe(-0.5)
  })

  it("subtractUnclamped matches subtract for positive results", () => {
    const a = rational(3, 4)
    const b = rational(1, 4)
    expect(subtractUnclamped(a, b)).toEqual(subtract(a, b))
  })

  it("multiplies fractions", () => {
    const a = rational(2, 3)
    const b = rational(3, 4)
    expect(multiply(a, b)).toEqual({ num: 1, den: 2 })
  })

  it("divides fractions", () => {
    const a = rational(1, 2)
    const b = rational(3, 4)
    expect(divide(a, b)).toEqual({ num: 2, den: 3 })
  })
})

describe("FCP string conversion", () => {
  it("formats zero", () => {
    expect(toFCPString(ZERO)).toBe("0s")
  })

  it("formats fraction", () => {
    // 240240/24000 simplifies to 1001/100
    expect(toFCPString(rational(240240, 24000))).toBe("1001/100s")
  })

  it("parses zero", () => {
    expect(parseFCPString("0s")).toEqual(ZERO)
  })

  it("parses integer seconds", () => {
    expect(parseFCPString("5s")).toEqual(rational(5, 1))
  })

  it("parses fraction", () => {
    const r = parseFCPString("1001/24000s")
    expect(r).toEqual(rational(1001, 24000))
  })

  it("roundtrips through format/parse", () => {
    const original = rational(1001, 24000)
    const str = toFCPString(original)
    const parsed = parseFCPString(str)
    expect(toSeconds(parsed)).toBeCloseTo(toSeconds(original), 10)
  })
})

describe("frame alignment", () => {
  const fps2397 = FRAME_RATES["23.976"]
  const fps2997 = FRAME_RATES["29.97"]
  const fps30 = FRAME_RATES["30"]

  it("aligns 10 seconds at 23.976", () => {
    const r = secondsToFrameAligned(10, fps2397)
    // 10s * 23.976fps = 239.76 frames -> 240 frames -> 240*1001/24000 simplifies
    const frames = toFrames(r, frameDuration(fps2397))
    expect(frames).toBe(240)
    // 240 frames at 23.976fps = ~10.01s (frame-aligned, not exact)
    expect(toSeconds(r)).toBeCloseTo(10, 1)
  })

  it("aligns 10 seconds at 29.97", () => {
    const r = secondsToFrameAligned(10, fps2997)
    const frames = toFrames(r, frameDuration(fps2997))
    expect(frames).toBe(300) // 10 * 29.97 ≈ 300
  })

  it("aligns exact seconds at 30fps", () => {
    const r = secondsToFrameAligned(5, fps30)
    expect(r).toEqual(rational(5, 1))
    expect(toFrames(r, frameDuration(fps30))).toBe(150)
  })

  it("roundToFrameBoundary preserves frame-aligned values", () => {
    const fd = frameDuration(fps2397)
    // Exactly 100 frames at 23.976
    const exact = rational(100 * 1001, 24000)
    const rounded = roundToFrameBoundary(exact, fps2397)
    expect(toFrames(rounded, fd)).toBe(100)
  })
})

describe("toFrames", () => {
  it("computes frame count for 29.97fps", () => {
    const dur = rational(300 * 1001, 30000) // 300 frames at 29.97
    const fd = frameDuration(FRAME_RATES["29.97"])
    expect(toFrames(dur, fd)).toBe(300)
  })

  it("computes frame count for integer fps", () => {
    const dur = rational(5, 1) // 5 seconds
    const fd = frameDuration(FRAME_RATES["24"])
    expect(toFrames(dur, fd)).toBe(120)
  })
})

describe("frame rate utilities", () => {
  it("nominalFrameRate for common rates", () => {
    expect(nominalFrameRate(FRAME_RATES["23.976"])).toBe(24)
    expect(nominalFrameRate(FRAME_RATES["29.97"])).toBe(30)
    expect(nominalFrameRate(FRAME_RATES["59.94"])).toBe(60)
    expect(nominalFrameRate(FRAME_RATES["25"])).toBe(25)
  })

  it("isNTSC", () => {
    expect(isNTSC(FRAME_RATES["29.97"])).toBe(true)
    expect(isNTSC(FRAME_RATES["23.976"])).toBe(true)
    expect(isNTSC(FRAME_RATES["25"])).toBe(false)
    expect(isNTSC(FRAME_RATES["30"])).toBe(false)
  })

  it("isDropFrame", () => {
    expect(isDropFrame(FRAME_RATES["29.97"])).toBe(true)
    expect(isDropFrame(FRAME_RATES["59.94"])).toBe(true)
    expect(isDropFrame(FRAME_RATES["23.976"])).toBe(false)
    expect(isDropFrame(FRAME_RATES["24"])).toBe(false)
  })
})

describe("parseTimecode", () => {
  it("parses non-drop timecode", () => {
    // 01:00:00:00 at 24fps = 86400 frames
    const r = parseTimecode("01:00:00:00", FRAME_RATES["24"])
    const frames = toFrames(r, frameDuration(FRAME_RATES["24"]))
    expect(frames).toBe(86400)
  })

  it("parses timecode with frames", () => {
    // 00:00:01:12 at 30fps = 42 frames
    const r = parseTimecode("00:00:01:12", FRAME_RATES["30"])
    const frames = toFrames(r, frameDuration(FRAME_RATES["30"]))
    expect(frames).toBe(42)
  })

  it("parses drop-frame timecode", () => {
    // 00:01:00;00 at 29.97fps drop-frame
    // Minute 1 drops 2 frames: total = 1*60*30 + 0 - 2 = 1798
    const r = parseTimecode("00:01:00;00", FRAME_RATES["29.97"])
    const frames = toFrames(r, frameDuration(FRAME_RATES["29.97"]))
    expect(frames).toBe(1798)
  })

  it("handles 10-minute boundary (no drop)", () => {
    // 00:10:00;00 at 29.97fps - 10th minute doesn't drop
    // Total dropped = 2 * (10 - 1) = 18
    // Total = 10*60*30 - 18 = 17982
    const r = parseTimecode("00:10:00;00", FRAME_RATES["29.97"])
    const frames = toFrames(r, frameDuration(FRAME_RATES["29.97"]))
    expect(frames).toBe(17982)
  })

  it("returns ZERO for empty string", () => {
    expect(parseTimecode("", FRAME_RATES["24"])).toEqual(ZERO)
  })

  it("returns ZERO for invalid format", () => {
    expect(parseTimecode("not-a-timecode", FRAME_RATES["24"])).toEqual(ZERO)
  })
})
