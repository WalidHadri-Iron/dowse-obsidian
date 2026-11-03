# Reliability and responsiveness — 2026-11-02

Changes following review of `2baf449`: exclusions follow renamed paths and are applied independently of search-cache
refreshes; delayed file changes resolve the current path and cannot restore deleted files. Model requests reject
after cancellation, are serialized in the worker, and have bounded lifetimes. Readers reacquire their model between
pieces, keep cancellation retryable, and stop before storage closes. Saves check the file revision inside their
transaction. Folder operations query only that subtree, and bursts of selection changes coalesce view refreshes.

Search construction, scoring and map layout now run in a dedicated worker with their own connection to the index.
Svelte's proxy arrays are copied at the messaging boundary. The default collection has every active indexed file;
the list renders a visible window and retains scrolling access to every row. Quick search refreshes on model
readiness/index changes, debounces input, ignores obsolete responses and labels closest candidates when no clear
match exists. Explicit and inferred folder/date/type constraints are visible and removable.

The model's files are pinned to revision `daa72c51243991dfcaf9f9137d2c573d8f7790c0`, included in its index identity.
Old unpinned indexes rebuild once. Settings offers the processor explicitly; automatic mode falls back to it for a
GPU adapter/startup/computation failure. Runtime capabilities are checked independently of Obsidian's app version.

Audio input is checked for file size and duration before decoding, with a decoded-buffer cap and native asynchronous
channel mixing. This is bounded browser decoding, not streaming: long recordings remain searchable by name. Scanned
PDF additions render/embed/save a page at a time with a persisted resume position. Preview keys include attachment
mtime/size; media preview waits can time out or be cancelled. Opening media seeks to its matched timestamp; canvas
opening selects the matching card when supported by the installed view.

## Checks

- 62 tests pass, including event ordering, rename exclusions, immediate cached-result gates, worker cancellation and
  shutdown races, atomic saves, resumable scanned-PDF additions, filters, inferred screenshot kinds, GPU fallback
  and serialization of indexing/search inference. TypeScript and Svelte report zero errors/warnings. Production
  build passes. Dependency audit reports zero known vulnerabilities at the time of the checks.
- The existing exported desktop index (65 files, 812 vectors) still gives the same first result, top ten and strong
  count for all 160 queries: R@1 .934, R@5 .993, MRR .961, false alarms 1/8. This is parity on the cached testbed,
  not a new end-to-end retrieval benchmark. No ranking thresholds were tuned for these changes.
- Urgent invalidation is versioned: a completed reader or selection change arriving during a build cannot be
  overwritten by that older build's timestamp and leave an empty/stale collection published.
- Real installed Windows Obsidian (Electron 39.8.3 / Chromium 142): first-run setup, reading a disposable vault,
  rename/delete/exclusion lifecycle, Quick search, list/wall/map, multiple folder selection, inferred filter removal,
  media decoding limits, media timestamp opening, canvas selection, and actual GPU/CPU reference inference.
- Text reference cosine against the desktop model: WebGPU .999928, WebAssembly with two threads .999955.
- Cold Quick search for `Portuguese public transportation` refreshes from words-only to the Lisbon note after the
  model starts, without retyping. An unclear `budget rhinoceros` query labels its screenshot candidate as closest.
- A 10-second WAV decodes to 160,000 mono samples; the 21-minute fixture is rejected from metadata. Aborted media
  work rejects as cancellation. Opening the WAV at 7 seconds seeks to 7; opening the second canvas card selects it.

## Controlled renderer comparison

Same installed Obsidian, same temporary IndexedDB data (2,000 synthetic notes, 20,000 vectors), same production
search implementation. The renderer path uses the in-process catalog retained for unit tests; the production path
uses its search worker. Background timer throttling is disabled for this comparison and long tasks are observed
on the renderer. No model inference is included in the timed section.

| Path | Build (including storage/worker overhead) | Largest interval gap | Renderer long tasks |
|---|---:|---:|---:|
| In-process catalog | 500 ms | 286 ms | 269 ms |
| Production search worker | 431 ms | 18 ms | none |

The original review's approximately 2-second interval reading was partly affected by Chromium's background timer
throttling. The controlled comparison above isolates renderer blocking; moving computation off the interface is
the material improvement, not a claim that the total computation becomes instantaneous. Results are from one PC.

The production smoke script also checks a 20,000-vector index for renderer long tasks and verifies windowed
rendering with a 2,000-file UI fixture, including reaching its last row. It runs with a separate profile/vault and
replaces only embedding with deterministic vectors, avoiding a model download. Real-model checks remain separate.

The repository now includes checks/builds on Windows, macOS and Linux and native Mac/Linux smoke jobs. These jobs
are configured; they have not been executed remotely as part of this local change. Mac/Linux native inference and
an old installer still require their own platform checks before distribution to those targets.
