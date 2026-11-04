# Developing Dowse for Obsidian

[Back to the README](../README.md) · [Usage guide](usage.md)

## Requirements

- Node.js **24** and npm.
- Python **3** for packaging; no third-party Python packages are needed for that step.
- `xz` on PATH on Linux/macOS. The Windows build can use Python's standard-library
  `lzma` support.
- An installed desktop Obsidian executable for native integration tests.
- On headless Linux, a virtual display such as `xvfb-run` and the native libraries
  required by Obsidian. See the [CI setup](../.github/workflows/check.yml).

Use a separate development vault. The test harnesses create their own disposable
profiles and vaults; they do not attach to your open user vault.

## Build and package

```sh
git clone https://github.com/WalidHadri-Iron/dowse-obsidian.git
cd dowse-obsidian
npm ci
npm run check
npm test
npm run build
python3 scripts/package.py
```

`npm ci` installs locked dependencies. `npm run build` produces `main.js` and
`styles.css` in the repository root. Together with `manifest.json`, those are the
three files needed under `<vault>/.obsidian/plugins/dowse/`.

The packager creates:

| Output | Purpose |
| --- | --- |
| `build/dowse/` | Plugin files, README, license and bundled third-party notices. |
| `build/dowse-obsidian-<version>.zip` | ZIP containing the ready-to-copy `dowse/` folder. |
| `build/SHA256SUMS` | Checksums of the archive and packaged files. |
| `build/release.json` | Version, source commit and checksums. |

The archive includes `THIRD_PARTY_NOTICES.md` and `licenses/`. Packaged README
links point to the source revision so guides and demos work outside a checkout.

The package is made from the current working tree. Commit metadata records HEAD;
it does not prove the working tree was clean. Review changes and build the exact
revision intended for release. Packaging checks that `package.json`,
`manifest.json` and `versions.json` agree.

Enable the plugin in the development vault and explicitly turn it on there.
Installing a build alone does not download the model or start reading.

For an unminified development build with inline source maps:

```sh
npm run dev
```

Re-run this command after source changes. It performs one build; it does not
watch files. Copy the changed output into your test vault, then disable/re-enable
the plugin to load it. For the optional measurement/test hooks in `src/dev/`, run
`node esbuild.config.mjs dev` explicitly.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Obsidian plugin lifecycle, commands and integration. |
| `src/plugin/` | Vault access, views, settings, previews, opening files and media seeking. |
| `src/engine/` | Model worker, indexer, storage, readers and retrieval. |
| `src/ui/` | Svelte panels, result lists, fisheye gallery and Explore. |
| `tests/` | Reader, retrieval, lifecycle and UI-logic checks; reference-vector fixtures. |
| `scripts/` | Native harnesses, measurements, fixtures and packaging. |
| `measurements/` | Recorded quality/performance/platform evidence and its limits. |
| `.github/workflows/` | Cross-platform checks and native integration jobs. |
| `docs/` | User/developer guides and focused README demonstrations. |
| `.cache/`, `build/` | Ignored local test artifacts and build packages. |

The model worker, search worker and ONNX WebAssembly runtime are bundled in
`main.js`; runtime JavaScript/WebAssembly is not fetched. Model data is downloaded
separately from a pinned Hugging Face revision. The built-in model is
EmbeddingGemma 2 fp16; its repository/revision is defined in
[`src/engine/protocol.ts`](../src/engine/protocol.ts). Each vault's index uses a
model tag so incompatible embedding spaces are not mixed.

Files are split into text passages, PDF pages, Canvas cards, images, sampled video
frames or overlapping audio passages. The readers keep locations for opening the
original file. Retrieval combines word and meaning search, applies filters and
returns matches plus less likely/closest candidates. The UI keeps raw scores hidden.

## Checks

| Command | What it checks |
| --- | --- |
| `npm run check` | TypeScript and Svelte checks. |
| `npm test` | Readers, retrieval, filters, exclusions, file events, cancellation and UI logic. |
| `npm run measure` | Model builds against reference vectors in Node; may require model downloads. |
| `npm run smoke` | Real Obsidian integration with deterministic test embeddings. |
| `npm run test:native-model` | Actual model indexing/search in native Obsidian. |
| `npm run test:vault` | Larger-vault indexing, changes/deletions, repeated queries and responsiveness. |
| `npm run test:views` | Native mixed-file views, media seeking and Excalidraw integration. |
| `npm run test:media` | Real-model media retrieval, timing and absent-query confidence against labelled fixtures. |

Tests that replace embeddings verify interaction and lifecycle behavior, not
semantic accuracy. Actual-model tests and media measurements cover retrieval
separately. Read the [measurement notes](../measurements/README.md) before making
performance or accuracy claims.

## Run native Obsidian tests

The following examples use a POSIX shell. Set `OBSIDIAN_EXECUTABLE` to your
installed executable; on macOS it is typically inside the app bundle.

```sh
OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run smoke
OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run test:native-model
OBSIDIAN_EXECUTABLE=/path/to/Obsidian DOWSE_STRESS_FILES=10000 npm run test:vault
```

In PowerShell, set the environment variable first:

```powershell
$env:OBSIDIAN_EXECUTABLE = 'C:\path\to\Obsidian.exe'
npm run smoke
```

On headless Linux, prefix commands with `xvfb-run -a`. For example:

```sh
OBSIDIAN_EXECUTABLE=/path/to/obsidian xvfb-run -a npm run smoke
```

Set `DOWSE_PLUGIN_DIR` to an unpacked release's `dowse/` folder to test those
exact files instead of the repository build. For example, after extracting the ZIP:

```sh
DOWSE_PLUGIN_DIR=/path/to/unpacked/dowse OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run smoke
```

Smoke artifacts go to `.cache/smoke/` or `DOWSE_SMOKE_ARTIFACTS`. Native model and
stress results go to `.cache/release-validation/<test>-<platform>/`. The harnesses
close their own profiles. Use `DOWSE_KEEP_PROFILE=1` to retain a failed profile for
inspection.

Actual-model checks download the pinned model into their disposable profile.
For offline tests, `DOWSE_MODEL_CACHE` can point to files in the original model
repository layout; files are verified against the pinned revision before use.

### Mixed views and Excalidraw

```sh
node scripts/install-test-excalidraw.mjs
OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run test:views
```

The installer verifies pinned Excalidraw 2.29.1 code in the test cache. The harness
tests actual readers, storage and views with deterministic embeddings: notes,
images, PDF, Canvas and audio; checkpoint/restart; oversize rejection before
decoding; confidence labels; 3D rendering; folder grouping; and light/dark drawing
previews plus native-editor opening. Set `DOWSE_TEST_SWIFTSHADER=1` for explicit
software rendering when needed. This is an interaction test, not an accuracy test.

### Audio and video accuracy

`npm run test:media` expects `DOWSE_MEDIA_CORPUS` to contain `truth.json` and a
`vault/` tree of media. Ground truth and transcripts stay outside the indexed vault.

```sh
OBSIDIAN_EXECUTABLE=/path/to/Obsidian \
  DOWSE_MEDIA_CORPUS=/path/to/corpus npm run test:media
```

[`scripts/make-media-corpus.py`](../scripts/make-media-corpus.py) creates controlled
fixtures from local Windows SAPI voices and the local testbed assets named in
[`scripts/fixtures/media-corpus.json`](../scripts/fixtures/media-corpus.json).
It requires ffmpeg and those source assets; they are not all bundled here.
[`scripts/degrade-media-corpus.py`](../scripts/degrade-media-corpus.py) creates
seeded-noise/speed variants with independent timing labels. Each script documents
its arguments.

| Environment option | Effect |
| --- | --- |
| `DOWSE_MEDIA_KINDS=audio` or `video` | Restricts modalities measured. |
| `DOWSE_MEDIA_DEVICE=wasm` | Forces processor inference. |
| `DOWSE_MEDIA_SEEK=1` | Opens unique returned moments in actual native players. |

The baseline uses the former 30-second audio windows and 10-second processor video
sampling. Reports separate file retrieval, passage timing, per-file regressions,
confidence false alarms and native seek behavior. Clean synthetic fixtures do not
substitute for noisy real recordings. Actual results are under
[`measurements/`](../measurements/README.md).

## CI and releases

[`Check plugin`](../.github/workflows/check.yml) runs types, tests and builds on
Windows, macOS 15 and Linux. It also runs native smoke, actual CPU inference and
5,000-file reliability jobs on Linux/macOS. Markdown-only changes are skipped;
the workflow can be dispatched manually. The build uploads installable artifacts.

[`Extended native integration`](../.github/workflows/extended.yml) is manually
dispatched. It exercises mixed views/Excalidraw on Linux/macOS, then actual
automatic model selection without forcing software rendering. GPU availability
depends on the runner. A configured job is not evidence that a particular revision
passed: inspect its run and saved artifacts before distributing that revision.

For a release, align the manifest/package/version map, run the appropriate checks,
build, package, and review the ZIP/checksums against the intended source commit.
Repository visibility and publishing a release are separate actions.

## Update the README demonstrations

The focused GIFs come from the approved continuous demo video. Timings and export
settings are in [`docs/media/clips.json`](media/clips.json). Re-export them with:

```sh
python3 scripts/make-readme-gifs.py /path/to/dowse-publication.mp4
```

This requires ffmpeg. The large source recording, local vault and model cache are
not committed. Do not substitute invented search results. Update the timing plan
when changing the source video and check the resulting GIFs before committing them.
