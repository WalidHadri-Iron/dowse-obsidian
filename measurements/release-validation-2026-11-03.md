# Release candidate validation — 2026-11-03

The combined changes were reviewed against `2baf449` and committed to the private
[Dowse Obsidian repository](https://github.com/WalidHadri-Iron/dowse-obsidian). Application changes end at
`465bdd2`; subsequent commits prepare CI, test harnesses, packaging and this record.

## Automated and native checks

- **79 automated tests pass.** TypeScript and Svelte report zero errors or warnings; the production build passes.
  Dependency audit reports zero known vulnerabilities at the time of testing.
- Checks and builds run on Windows, macOS and Linux. Native CI uses the official **Obsidian 1.15.0** installer,
  separate temporary profiles and vaults, and the production bundle.
- Native smoke checks cover first-run setup, real storage/search workers, exclusions following folder moves,
  immediate edit/delete events without ghost files, rebuild/disable, light/dark themes, and windowed collection
  rendering with scrolling/keyboard access to the last of 2,000 rows.
- A separate **real CPU model** test downloads the pinned text model, indexes three distinct notes, and checks
  three semantic queries. Lisbon transport, lentil cooking and certificate-expiry queries each return the correct
  note as a clear match. These tests passed on both Linux and macOS; they do not replace manual Apple GPU tests.
- **Final CI is green:** [run 41658988483](https://github.com/WalidHadri-Iron/dowse-obsidian/actions/runs/41658988483),
  testing commit `ab045f2`. All three check/build jobs and both native jobs pass, including 5,000-file reliability
  on Linux and macOS. Later documentation-only commits do not change this application build.

The model revision is `daa72c51243991dfcaf9f9137d2c573d8f7790c0`. Local model data, when used to avoid another
download, is verified against that revision's Git/LFS digests before seeding a disposable profile. User caches and
vaults are not copied into CI.

## Larger vault and ongoing interaction

Native Linux Obsidian under WSLg, **10,000 actual Markdown files**, approximately 6 KB per note, 20 folders.
The indexer, readers, IndexedDB, file events, search worker and UI are production code. Only inference is replaced
with deterministic 768-dimensional vectors and a small asynchronous delay. This measures lifecycle/reliability
and interface behavior, not real-model indexing throughput.

During the run, the harness repeatedly selects and deletes the query text using keyboard events, types a new
query and waits for its expected result. It edits 60 files three times each, deletes 20, renames 20, keeps the
remaining edits, excludes a folder, pauses/resumes, and disables/re-enables Dowse before continuing saved work.

| Result | Observed |
|---|---:|
| End-to-end run, including setup and interactions | 353.9 s |
| Active files expected / fully indexed | 9,481 / 9,481 |
| Stored rows, including retained exclusions | 9,980 |
| Stored vectors | 56,764 |
| Searches, spread throughout indexing | 64 |
| Search cycle median / 95th percentile / maximum | 819 / 6,746 / 7,416 ms |
| Largest renderer task during interaction | 70 ms |
| Largest gap in the 20 ms sampling timer | 76.2 ms |
| Failed files, stale edits, deleted ghosts, obsolete rename paths | 0 |
| Excluded-folder hits, renderer errors, console errors | 0 |

Search-cycle time includes clearing, typing, debounce and waiting for results. Large background index rebuilds
can still make results take several seconds; the renderer remains available for input. This is not a promise of
instant results or zero hitches for arbitrary vaults or hardware. The sampler stops before the harness's final
whole-vault verification so that test verification is not counted as application interaction.

The run exposed repeated full-file-table reads before each indexed file. Indexing now retains its pending queue,
invalidates it on mutations and checks the next row separately. Tests bound full-vault reads over 200 files and
verify edits, additions, deletions, renames, unreadable files, obsolete read failures and concurrent completed saves.
Failure writes now use the same atomic revision guard as successful saves.

Local evidence: `.cache/release-validation/stress-linux-queue/results.json` and `linux-stress-queue.log`.
The native CI stress jobs use 5,000 files with the same portable harness.

Additional 5,000-file runs on the final application code:

| Platform | Duration | Active files complete | Renderer exceptions | Largest task / timer gap |
|---|---:|---:|---:|---:|
| Windows, installed Obsidian | 253.9 s | 4,731 / 4,731 | 0 | below 50 ms / 60.6 ms |
| Linux, GitHub Actions/Xvfb | 251.9 s | 4,731 / 4,731 | 0 | 112 ms / 118.5 ms |
| macOS 15, GitHub Actions | 541.4 s | 4,731 / 4,731 | 0 | below 50 ms / 176.4 ms |

All three runs finish without failed files, stale edits, deleted ghosts, obsolete rename paths or excluded-folder hits.
The Windows and Linux runs log file-not-found messages for deliberately deleted notes during Obsidian's asynchronous metadata reads; final storage and search checks contain none of those deleted paths.
Large-vault result refreshes can still take seconds: Linux CI's maximum measured search cycle was 10.8 seconds.
Mac completed 106 search cycles (409 ms median, 3,218 ms 95th percentile, 3,430 ms maximum) with no console errors.
Evidence is in `.cache/release-validation/stress-win32-queue/results.json` and both native CI artifacts.

## Broader audio/video comparison

Fresh production readers and actual model inference in installed **Windows Obsidian on NVIDIA Lovelace/WebGPU**.
The controlled corpus contains eight spoken recordings (MP3, M4A, OGG, FLAC and WAV) and five videos, with three
distinct sections/shots each. Ground truth is obtained from independently synthesized section durations and known
shot boundaries. Transcripts, labels and queries remain outside the indexed vault; filenames are neutral.

Both variants use the same pinned model, media files and queries. The baseline overrides only audio window/hop
to the former 30/25 seconds; the current GPU setting is 8/4 seconds. The comparison was repeated after the pending
queue change with the same results.

| Metric | Previous passages | Short passages |
|---|---:|---:|
| Audio positive queries | 48 | 48 |
| Audio correct file at rank 1 / within top 5 | 48 / 48 | 48 / 48 |
| Primary audio passage overlaps the correct section | 48 / 48 | 48 / 48 |
| Median absolute section-start error | 7.26 s | 1.85 s |
| Median passage length | 30 s | 8 s |
| Absent audio queries / clear false alarms | 6 / 0 | 6 / 0 |
| Video positive queries / correct file at rank 1 | 14 / 14 | 14 / 14 |
| Primary video moment in the correct shot | 14 / 14 | 14 / 14 |
| Median video shot-start error | 0 s | 0 s |

No baseline file-retrieval regressions occurred. The dog query returns both expected videos with the correct
0-second and 12-second shots in both variants. All 13 files finished reading, with no renderer or console errors.
The cached desktop testbed also retains the same first result, top ten and strong count on all 160 queries.

These are clean synthetic voices and static known shots, not noisy speech, music, a multilingual benchmark or
word-aligned transcription. A positive file query succeeds when a relevant file appears; these numbers do not
establish recall over arbitrary relevant files. Processor passages use 12/6 seconds and video frame sampling is
coarser on the processor; the broad accuracy table above is a GPU comparison. The optional full Linux CPU-media
run was stopped when competing host workloads exhausted available memory; it is not counted as a pass.

Local evidence: `.cache/release-validation/media-win32/results.json`, `raw.json`, `media-after-queue.log`, and
`media-corpus/truth.json`. Reproduce using `scripts/make-media-corpus.py` and `npm run test:media` as documented
in README. Earlier actual player clicks, timestamp seeking, Excalidraw editor opening and preview fitting are
recorded in `media-and-indexing-2026-11-03.md` and `.cache/demo-expansion/`.

## Test-harness corrections

Earlier runs are not presented as application passes or application crashes:

- Waiting for all indexing work to finish while paused deadlocked the harness. It now waits only for paused/idle
  status before resuming. Chromium graphics messages emitted while terminating that timed-out test were cleanup
  artifacts, not evidence of a graphics crash during normal use.
- CDP Meta+A does not invoke macOS's native select-all edit command. The harness now selects the input explicitly,
  then tests actual keyboard deletion/typing and asserts that the field was cleared.
- The sampler now tolerates the intentionally disabled plugin. Its earlier `engine`/`status` errors came from
  dereferencing the plugin during that test action, not from application callbacks.
- Fresh-profile automation enables the known production plugin explicitly after vault startup, avoiding an
  overlap with Obsidian's initial automatic plugin loading/trust UI. Startup stages are captured on failure.
- Windows uses standard-library Python LZMA for the bundled XZ runtime because the proposed Chocolatey `xz`
  package did not exist. All three platform builds pass with the portable compressor.

## Packaging and remaining limits

`npm run build` followed by `python3 scripts/package.py` produces `build/dowse-obsidian-0.1.0.zip`, an installable
`build/dowse/` folder, `SHA256SUMS` and `release.json` with the source commit. ZIP metadata is fixed; contents and
checksums are verified against the production build. CI provides an install artifact as well.

Use a separate vault for release-candidate testing. Native automated checks cover CPU inference and core Obsidian
integration; manual Apple GPU/driver behavior, larger real-media collections, noisy recordings and older installers
remain outside this validation. Browser media decoding limits and Explore's representative sampling are documented
in README. The application was not published to the Obsidian community directory.
