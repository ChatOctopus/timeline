# OTIO-First Redesign for Unpublished `@chatoctopus/timeline`

## Summary

Because the package is not published yet, replan this as a redesign, not an additive extension. OTIO should become the primary semantic model, and FCPXML/xmeml should be treated as secondary adapters over that model. The current `assets[] + tracks[].clips[] + assetId` shape is the wrong center of gravity for metadata, markers, transitions, explicit gaps, and still-image timelines.

This replan keeps rational time utilities and the overall import/export purpose, but it intentionally replaces the primary public model and builder APIs in [`nle/src/types.ts`](/Users/moin/Developer/octo/nle/src/types.ts), [`nle/src/index.ts`](/Users/moin/Developer/octo/nle/src/index.ts), and rewrites the README around the new model in [`nle/README.md`](/Users/moin/Developer/octo/nle/README.md).

## Key Changes

- Replace the primary public model with OTIO-first core types:
  - `Timeline`
  - `Track`
  - `TrackItem = Clip | Gap | Transition`
  - `MediaReference = ExternalReference | MissingReference`
  - `Marker`
  - `TimeRange`
- Make `Track.items` the canonical structure. Gaps become explicit items; transitions are explicit items; clips no longer encode gaps indirectly through offsets alone.
- Remove `assets[]` and `assetId` from the primary public API. `Clip` should carry its `mediaReference` directly. Adapter layers may dedupe references internally when exporting to FCPXML/xmeml.
- Replace `hasVideo` / `hasAudio` as primary modeling tools with `mediaKind` and optional `streamInfo`. Use `ExternalReference` plus `mediaKind: "image"` for still-image support; do not add `ImageSequenceReference` in this redesign.
- Add first-class OTIO-relevant fields now, not later:
  - `metadata?: Record<string, unknown>` on timeline, track, clip, transition, marker, and media reference
  - `markers?: Marker[]` on timeline, track, and clip
  - `globalStartTime?: Rational` on timeline
  - `enabled?: boolean` where OTIO supports it
- Keep `importTimeline()` and `exportTimeline()` as the top-level function names, but change them to operate on the new OTIO-first model.
- Replace `buildTimeline()` with two explicit builders:
  - `buildTimelineFromFiles()` for probe-based, linear assembly from existing media
  - `createTimeline()` for programmatic OTIO-first assembly
- Replace `probeAsset()` with `probeMediaReference()` so the API matches the new model.
- Do not introduce first-class effect modeling in this redesign. OTIO `effects` remain out of scope for v1; reader behavior should warn and drop them rather than invent a half-modeled public API.

## Implementation Plan

### Phase 1: Core model redesign and failing tests first
- Write failing tests for the new public model shape before editing implementation.
- Replace the old core types with the OTIO-first model and update exports.
- Add `TimeRange`, `Marker`, `Transition`, `Gap`, `ExternalReference`, and `MissingReference`.
- Remove the top-level asset registry from the primary model.
- Rewrite README type examples immediately after the tests pass so docs match the new API.

### Phase 2: OTIO adapter rewrite
- Rewrite `readOTIO()` and `writeOTIO()` around the new model instead of translating OTIO into the old asset-table abstraction.
- Round-trip metadata, markers, transitions, explicit gaps, `global_start_time`, enabled flags, and media references.
- Support still images via `ExternalReference` with `mediaKind: "image"` and explicit ranges.
- Add fixture-based round-trip tests first, then implementation, then README OTIO examples.

### Phase 3: Builder and probing redesign
- Add failing tests for `probeMediaReference()`, `buildTimelineFromFiles()`, and `createTimeline()`.
- Implement `probeMediaReference()` to classify `video`, `audio`, and `image`, and populate `streamInfo` plus available range.
- Implement `buildTimelineFromFiles()` as the narrow helper for linear edits from probed files.
- Implement `createTimeline()` as the ergonomic path for slideshow/synthetic timelines.
- Remove or fully replace the old `buildTimeline()` examples in the README; do not keep two competing builder stories.

### Phase 4: FCPXML/xmeml adapter rewrite
- Rewrite FCPXML/xmeml import/export to adapt the new model rather than the old one.
- Exporters should internally derive/dedupe resource tables as needed; the public model should stay OTIO-first.
- Importers should produce explicit gaps and clip media references in the new model.
- Unsupported OTIO-first fields must degrade with warnings, not silent loss.
- Add failing cross-format tests first, then implementation, then README compatibility notes.

### Phase 5: CLI, docs, and cleanup
- Update CLI behavior and messages to reflect the new model and new builder names.
- Rewrite README structure around: OTIO-first model, builder APIs, still-image support, lossy cross-format behavior, and TDD-backed guarantees.
- Remove stale references to the old `NLETimeline` asset-table model.
- Finish with a final test sweep and release notes draft.

## Test Plan

- Use TDD in every phase: smallest failing test first, minimum implementation second, refactor third, README update fourth.
- OTIO tests:
  - metadata round-trip on timeline, track, clip, transition, marker, and media reference
  - marker round-trip with ranges
  - transition round-trip
  - explicit gap round-trip
  - still-image, audio-only, and video-only references
  - `global_start_time` and enabled flags
- Builder tests:
  - `probeMediaReference()` classification for video, audio, and image
  - `buildTimelineFromFiles()` for simple probe-based edits
  - `createTimeline()` for slideshow-like synthetic assembly
- Cross-format tests:
  - OTIO -> FCPXML/xmeml export with documented warnings
  - FCPXML/xmeml -> OTIO-first model import
  - no silent dropping of supported fields
- CLI tests:
  - convert/validate still work against the redesigned model
  - warnings are surfaced for lossy conversions

## Assumptions

- Breaking public API changes are acceptable because the package is not published yet.
- OTIO fidelity is the primary goal; FCPXML/xmeml are important but secondary.
- `compute` is not yet importing this package directly, so redesigning the public API now is cheaper than layering compatibility shims.
- First-class OTIO effect modeling is out of scope for this redesign; unsupported effects warn and drop.
- README updates are part of each phase’s definition of done, not a final cleanup task.
