# Dowse for Obsidian

Find anything in your vault by what's in it: notes, PDFs, images, recordings and videos, searched by meaning, on
your computer. Work in progress.

- Runs inside Obsidian: no app or account. Each vault has its own index.
- The model, [EmbeddingGemma 2](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX), is downloaded at a pinned revision
  from Hugging Face when you first turn Dowse on, and runs on your GPU (WebGPU) or processor.
- Desktop only, for now.

## Install and try it

Use a separate test vault first. Copy `main.js`, `manifest.json` and `styles.css` from a production build into
`<vault>/.obsidian/plugins/dowse/`, then enable **Dowse** under **Settings → Community plugins**. For an update,
disable Dowse, replace those three files together, and enable it again. Installing the plugin does not start a
download or read the vault: open its ribbon icon or **Dowse: Open Dowse** and choose **Turn on for this vault**.

Desktop Obsidian 1.8 or later is required, with a recent **installer/browser runtime** that supports `Float16Array`,
workers, OffscreenCanvas and IndexedDB (Chromium 135 or later). The plugin checks these capabilities before it opens
the index. If it asks for an installer update, download Obsidian again from [obsidian.md/download](https://obsidian.md/download)
and reinstall: the in-app updater can leave Electron unchanged. Your notes are kept. Mobile is not supported.

The text model takes about **542 MB**. Reading images, scanned PDFs and video frames adds about **336 MB**; reading
recordings and videos' sound adds about **587 MB**. These choices are offered before turning Dowse on and later in
its settings. Only model data is downloaded from Hugging Face; the runtime code is bundled with the plugin. Vault
content is processed locally. Model data is cached in Obsidian's profile, and each vault's index is in its own local
IndexedDB database, outside the vault. Settings follow the vault; the index is not synced.

The index is rebuilt once when upgrading from an unpinned model build. This prevents mixing vectors from different
model revisions. It does not change original files. The cached model can be removed from Dowse settings after
turning Dowse off; it is otherwise retained when the plugin is removed.

## Use

- Excalidraw's **.excalidraw.md** files are searched through their readable text and descriptions; hidden compressed
  scene data is excluded. With the Excalidraw community plugin enabled, Wall and Explore render the actual drawing,
  fitting the whole diagram, and results open in the Excalidraw editor rather than at a Markdown line. Previews
  refresh when a drawing changes and do not require a manually exported image. Export to PNG to search visual
  content as well; a standalone **.excalidraw** JSON file is not currently indexed.
- **Search the vault** opens Quick search. Give that command a shortcut in **Settings → Hotkeys**. When Dowse is
  off, it opens the first-run screen instead. Quick search starts with recent files; it refreshes when the model
  wakes and distinguishes clear matches from closest candidates. Scores are kept out of the interface.
- **Open Dowse** opens the full collection. The default list includes every indexed active file, with windowed
  rendering so large collections do not create thousands of visible rows. Search, the wall, and Explore share the
  same engine. Quick search intentionally shows only 20 recent files and a short result list.
- **Folders** allows multiple vault folders; selecting a parent includes its descendants. **Vault root files**
  includes only files directly in the vault. **Date** chooses an inclusive range of modification dates. Folder,
  type and date filters appear as removable chips, including constraints inferred from a query. Removing an inferred
  chip stops applying that constraint until the query is edited again. The Explore floor hides filtered-out files.
- Right-click a file or folder and choose **Dowse: stop searching**. Excluded content stays excluded through moves
  and renames, and is hidden immediately from search, recent files, Explore and similar results. Turning a parent
  folder back on preserves explicit child exclusions. Exclusions retain the index; deleting the index in settings
  does not delete notes.
- Opening a result jumps to its note line, PDF page, or recording/video timestamp. Canvas cards are selected when
  the current Obsidian canvas view exposes its selection API.
- Audio/video results expose clickable **Matching moments** in Quick search, the list, and the selected result in
  Wall or Explore. Audio uses overlapping 8-second passages on the GPU (12 seconds on the processor); ranges are
  approximate rather than word-aligned transcripts. Video frame timestamps identify sampled frames (normally
  every 3 seconds on the GPU or 10 seconds on the processor, spaced further apart in long videos). Media files
  indexed with the older 30-second audio windows are reread automatically once after upgrading.
- Search remains usable while indexing. Editing or clearing the query invalidates older responses immediately;
  previous results cannot be opened while a different query is pending. Background refreshes retain the selected
  result, Explore's manual camera position, and existing thumbnails. Updated files refresh their own previews.
- **Settings → Dowse → Run the model on** selects automatic WebGPU or the processor. Automatic falls back to the
  processor if GPU startup or computation fails. Changing the device or media options is safe while indexing.
- Reading can be paused, including automatically on battery. The model sleeps after ten idle minutes. Closing or
  disabling the plugin cancels pending work and shuts down its readers before closing storage.

Explore offers **By content** (automatic clusters of similar files) and **By folder**, and remembers the choice.
Folder groups use each file's immediate parent path, so nested folders stay distinct; files directly in the vault
are grouped under **Vault root files**. Folder grouping also includes files found only by name and needs no model.
For very large vaults Explore shows representative files from each group (up to about 1,200 on the floor), with the
full counts. The list remains the way to browse every file.

### Browser media limits

Obsidian's browser decodes a complete audio stream at once. Dowse checks metadata first and does not decode files
over **32 MiB** or **20 minutes**; a decoded buffer over **128 MiB** is rejected. It mixes channels asynchronously,
and reading can be stopped. This bounds accepted work; the browser's native decoder can still allocate temporary
memory while decoding. Recordings beyond those limits remain searchable by filename. Videos can still be read for
their frames when their sound is too large. Split a long recording into shorter files to search its content.

Scanned PDF pages are added and saved one at a time when image reading is enabled later, so interruption resumes
from the last saved page. PDF text is not embedded again. Unreadable media remains available by name with a reason
in its indexed information. Supported codecs depend on the Obsidian installer/browser runtime.

### Troubleshooting and tests

If a model download or startup fails, check the message in the Dowse tab, try **Try again**, or select **Processor**
in settings. An initial download requires access to Hugging Face. Once the model's selected parts are cached,
inference works without a network connection. For persistent errors, open Obsidian's developer console and look for
Dowse messages. If IndexedDB or the model cache is cleared by another tool, the data must be read/downloaded again.

The Windows production plugin is tested in a separate real Obsidian profile. CI runs type checks, tests and builds
on Windows, macOS and Linux, and includes native Mac/Linux smoke jobs. The smoke job replaces only embedding with
deterministic test vectors, so it tests real Obsidian events, local storage, the search worker and views without
downloading a model. CI also runs real CPU model indexing/search and a 5,000-file reliability test on Mac/Linux. GPU and broader media accuracy checks run separately. A configured CI
job is not a claim that it has run on a particular revision; inspect its results before distributing that build.

## Development

```sh
npm install
npm run build          # main.js
python3 scripts/package.py  # install ZIP, build/dowse/ files, SHA256SUMS and commit metadata
npm run check          # types
npm test               # readers, search, file events, exclusions, cancellation, filters
npm run measure        # the model builds against the reference vectors (Node)
# Actual Obsidian integration, with an isolated disposable profile/vault:
OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run smoke
# Real CPU inference (downloads the pinned text model into a disposable profile):
OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run test:native-model
# Native storage/indexing/UI; deterministic embeddings, no download:
OBSIDIAN_EXECUTABLE=/path/to/Obsidian DOWSE_STRESS_FILES=10000 npm run test:vault
```

`measurements/` holds what chose the model build.

Build with Node 24, npm, and `xz` on PATH (Python with standard-library `lzma` on Windows). `npm ci` installs the locked dependencies. The model's worker, search
worker, and ONNX WebAssembly runtime are included in `main.js`; no runtime JavaScript or WebAssembly is fetched.
CI build artifacts contain the three files needed for manual installation. A native smoke test needs an installed
Obsidian executable; on a headless Linux machine run it under `xvfb-run`. It creates and closes only its own profile
and vault, and writes its results/screenshots under `.cache/smoke` (or `DOWSE_SMOKE_ARTIFACTS`).

The native model and stress checks save results under `.cache/release-validation/<test>-<platform>/` and remove
only their own temporary profiles. Set `DOWSE_KEEP_PROFILE=1` to retain a failed profile. For offline native model
checks, `DOWSE_MODEL_CACHE` may point to model files in their original repository layout; files are verified against
the pinned revision before being copied into the disposable cache. These tests never attach to an open user vault.

The media accuracy harness (`npm run test:media`) compares the previous 30-second passages with current shorter
passages using the same pinned model. `DOWSE_MEDIA_CORPUS` must contain `truth.json` and a `vault/` tree of media.
`scripts/make-media-corpus.py` generates the controlled corpus from local Windows SAPI voices and the owned testbed
photos named in `scripts/fixtures/media-corpus.json` (requires ffmpeg). Ground truth and transcripts stay outside the
vault. Reports distinguish file retrieval, passage timing, and absent-query confidence; clean synthetic fixtures do
not substitute for noisy real recordings. See `measurements/` for actual run results and their limits.
