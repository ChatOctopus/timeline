# Contributing

Thanks for helping improve `@chatoctopus/timeline`. The single most valuable
contribution is a **real timeline file exported from a real editor** — those are
what prove the library reads what Final Cut Pro, Premiere, and Resolve actually
write.

## Contributing a timeline file

Every file in [`tests/fixtures/`](tests/fixtures/) is swept automatically by the
test suite: it gets imported, validated, exported to every format, and
round-tripped. **A new fixture needs no test code** — the file *is* the test.

There are two ways to send one, depending on whether you use git.

### Option A — Pull request (if you're comfortable with git)

1. Sanitize the file (see below).
2. Drop it into `tests/fixtures/` (keep the `.fcpxml`, `.xml`, or `.otio`
   extension).
3. Run `npm install && npm test` to confirm it imports and round-trips.
4. Open a pull request.

### Option B — Issue (no git required)

1. Sanitize the file (see below).
2. Open a [**Share a timeline file**](../../issues/new?template=timeline-file.yml)
   issue and drag the **zipped** file into it — GitHub won't accept a raw
   `.fcpxml` / `.otio` / `.xml` attachment, so zip it first.

## Sanitize before you share — required

Real exports embed **absolute media paths** that leak your username, drive
layout, and often client or project names (for example
`file:///Users/you/Movies/BigClient_Final/clip.mov`). Scrub them first with the
built-in tool:

```bash
npx @chatoctopus/timeline sanitize ./your-export.fcpxml --out ./your-export.sanitized.fcpxml
```

It rewrites every media path to a neutral placeholder
(`file:///media/clip-0001.mov`) and prints what it changed, while leaving the
rest of the file — transitions, markers, structure — untouched.

**It does not scrub everything.** Project names, sequence names, clip names, and
marker text can also carry private information and are left alone. Open the
sanitized file and check, by eye:

- [ ] No real file paths remain (search for your username, `Users`, `Volumes`, `C:\`).
- [ ] Project / sequence / clip names contain nothing confidential.
- [ ] Marker and note text contains nothing confidential.

When in doubt, rename things to generic labels before sharing.

## What makes a great fixture

A trimmed clip or two is plenty — **smaller is better** (easier to review, less
to leak). The most useful files are ones that exercise areas the adapters don't
fully cover yet:

- Final Cut container elements: `<clip>`, `<sync-clip>`, `<mc-clip>`,
  `<ref-clip>`, `<audition>`, `<title>`
- Transitions, markers, and clip/timeline metadata
- Multicam edits and compound / nested sequences
- Drop-frame timecode (29.97 / 59.94), 23.976, and **mixed** frame rates
- Multiple audio tracks and stereo / mono / surround layouts

Please mention which **editor and version** produced the file.

## Licensing

By contributing a file or code, you confirm that **you have the right to share
it**, that it contains **no confidential information**, and that you agree to
license your contribution under this project's [MIT license](LICENSE).

## Developing the package

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # run the suite
npm run lint       # type-check without emitting
npm run test:coverage
```
