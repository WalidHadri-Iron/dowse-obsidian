# Dowse for Obsidian 0.1.1 — preview

Search an Obsidian vault by meaning across notes, PDFs, images, recordings, videos
and Canvas cards. Processing runs locally, with a one-time download of the selected
EmbeddingGemma 2 model parts. This is a desktop preview for manual installation.

## Submission preparation

- Release tag `0.1.1` matches the plugin manifest exactly. Individual `main.js`,
  `manifest.json` and `styles.css` assets support Obsidian's community installer.
- Dependency licenses/notices are embedded in `main.js` as well as the ZIP.
- Minimum app version is now **Obsidian 1.15.0**, matching native test coverage.
- Settings use the host's declarative lifecycle with searchable aliases. View
  preferences now use Obsidian's vault-scoped storage.
- Official submission lint checks cover TypeScript and Svelte source. The pinned
  ONNX GPU-selection setting reports one deprecation warning; lint has no errors.

## Included

- Quick search, a full list, the fisheye gallery and Explore, with clear matches
  distinguished from closest candidates. Stronger gallery matches appear larger.
- Multiple-folder, date and file-type filters, including removable inferred filters.
- Approximate matching moments in recordings/videos, with native-player seeking.
  Processor video sampling now also covers short shots at the base 3-second grid.
- Related-file discovery and link insertion from the current note.
- Excalidraw previews/editor opening when that plugin is enabled; readable drawing
  text is searched without indexing its hidden compressed scene data.
- Background indexing with pause/resume, file edits/deletions/moves and exclusions,
  and protection against stale query responses and stale saves.
- GPU-preferred automatic inference with processor fallback and a pinned model
  revision. Upgrading an old unpinned index rebuilds it once.

## Install

1. Download and unzip `dowse-obsidian-0.1.1.zip`.
2. Copy its entire `dowse/` folder into a test vault's `.obsidian/plugins/` folder.
3. Enable Dowse under Settings → Community plugins, open the Dowse tab and choose
   **Turn on for this vault**. Pictures and sound are optional model downloads.

To update, disable the plugin and replace its files together before enabling it
again. The archive includes dependency licenses/notices. `SHA256SUMS` and
`release.json` identify the archive, packaged files and exact source revision.

## Validation and current limits

The release's source revision is checked by the linked CI runs. Local validation
includes 82 unit tests, type/Svelte checks, and actual CPU-model indexing/search
in native Obsidian. The previous preview ZIP was also tested in Windows and Linux. CI covers builds on
Windows/macOS/Linux, native model/reliability checks on macOS/Linux, and extended
mixed-view/Excalidraw integration and settings enable/disable/processor changes. These do not replace manual Apple GPU testing.

Audio content search currently accepts recordings up to 20 minutes and 32 MiB,
with a 128 MiB decoded limit. Split longer recordings; oversize files remain found
by name. Passage ranges are approximate, and sampled video frames can miss events
between samples. Codecs depend on the installed Obsidian runtime. The model's
initial read can take time and needs local memory/storage. No mobile support yet.

See the README and usage guide for setup and limits, and `measurements/` for the
scope and limitations of earlier retrieval and larger-vault measurements. The
current demo GIFs use an original-content synthetic vault; they are illustrations,
not latency or retrieval benchmarks. The Obsidian directory listing requires its own review before installation
through Community plugins becomes available.
