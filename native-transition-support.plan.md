# Native Transition Support Plan

## Goal

Add native transition support to FCPXML and xmeml without changing the core `Timeline` model again.

Use the current overlap semantics as the source of truth:
- `Track.items` stays canonical
- `Transition.inOffset + outOffset` defines the overlap duration
- no new effect system
- no compound-clip work in this effort

Work phase by phase. Stop after each phase, run tests, and reassess whether the adapter shape still feels simple.

## Guardrails

- Use TDD in every phase: failing fixture/test first, minimal implementation second, cleanup third, docs fourth.
- Do not invent a generic “adapter transition abstraction” unless both formats actually need the same thing.
- Keep unsupported cases explicit with warnings rather than partially modeling them.
- Prefer supporting the common case first:
  - one transition between two adjacent clips on the same track
  - video tracks first
  - linked A/V only after the simple case is stable

## Phase 1: FCPXML Export

### Scope

Emit native FCPXML transition elements instead of flattening core transitions into butt cuts.

### Tests First

- simple video-track dissolve: `clip -> transition -> clip`
- exported `<sequence duration>` matches native-transition timing
- adjacent clip `offset`, `start`, and `duration` stay correct
- unknown `transitionType` warns and falls back to a supported FCPXML transition shape
- existing no-transition exports remain byte-stable where possible

### Implementation

- Add a focused FCPXML transition writer path in `src/fcpxml/writer.ts`
- Reuse `src/timeline-logic.ts` for overlap math; do not fork timing logic inside the writer
- Emit transition nodes only for transitions between adjacent primary-track clips
- Keep connected clips/secondary tracks on the current logic until proven necessary
- Warn and flatten only when a transition shape is not representable in current FCPXML export

### Done

- FCPXML export no longer warns for the supported adjacent-clip case
- existing non-transition FCPXML tests still pass
- README gets one short note describing the supported FCPXML transition subset

### Reassess

- Does the writer still read clearly?
- Did we need any new core-model fields? If yes, stop and justify before moving on.

## Phase 2: xmeml Export

### Scope

Emit native xmeml `transitionitem` structures instead of flattening transitions.

### Tests First

- simple dissolve export with correct `transitionitem`
- sequence duration reflects transition overlap
- adjacent clip `start/end/in/out` values remain coherent
- linked video/audio clipitems stay valid around the transition
- unsupported transition types warn cleanly

### Implementation

- Add a dedicated xmeml transition writer path in `src/xmeml/writer.ts`
- Keep the payload builder simple: clip payloads stay clip payloads; transition items are emitted in the sequence-writing layer
- Do not generalize FCPXML and xmeml transition emission prematurely; share helpers only if the duplication is obviously real
- Preserve current link generation unless a concrete xmeml transition case forces adjustment

### Done

- xmeml export no longer warns for the supported adjacent-clip case
- existing non-transition xmeml tests still pass
- README gets one short compatibility note for xmeml transition support

### Reassess

- Is xmeml forcing a different notion of overlap than the core model?
- Are audio link semantics still trustworthy?

## Phase 3: FCPXML Import

### Scope

Parse native FCPXML transitions back into core `Transition` items.

### Tests First

- import `clip -> transition -> clip` into the correct `Track.items`
- imported `inOffset/outOffset` reproduce the source overlap
- mixed timeline with gaps plus transitions preserves item order
- unsupported nested/spine cases warn instead of silently mis-parsing

### Implementation

- Extend `src/fcpxml/reader.ts` to parse transition nodes alongside asset clips and gaps
- Keep the parser narrow:
  - same-track, adjacent transition cases first
  - warn on more complex spine layouts until proven necessary
- Reuse existing placement reconstruction where possible; avoid a second timeline-building algorithm just for transitions

### Done

- FCPXML import/export round-trip preserves supported transitions
- warnings are explicit for unsupported transition shapes

### Reassess

- Is the parser still understandable?
- Are unsupported cases rare enough to leave as warnings for now?

## Phase 4: xmeml Import

### Scope

Parse native xmeml transition items back into core `Transition` items.

### Tests First

- import `transitionitem` into `Track.items`
- imported adjacent clip timing stays coherent
- linked audio/video timelines still import predictably
- malformed or ambiguous transition structures warn, not silently flatten

### Implementation

- Extend `src/xmeml/reader.ts` to parse `transitionitem`
- Build transitions only when the adjacent clips are unambiguous
- Prefer warnings over clever heuristics

### Done

- xmeml import/export round-trip preserves supported transitions
- audit tests cover at least one supported transition fixture per format
