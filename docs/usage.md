# Using Dowse

[Back to the README](../README.md)

This guide covers search, navigation, settings and current limits. For building or
testing the plugin, see the [development guide](development.md).

## First use

Install and enable Dowse as described in [Install](../README.md#install). Click its
ribbon icon, or run **Dowse: Open the search tab** from Obsidian's command palette.
Choose whether to read pictures and sound, then **Turn on for this vault**. These
options can be changed later under **Settings → Dowse**.

Desktop Obsidian 1.8+ needs an installer/runtime with `Float16Array`, workers,
OffscreenCanvas and IndexedDB. Dowse checks those capabilities before opening the
index. If setup requests an installer update, follow the troubleshooting steps below.

The initial model download and first read take time, especially for images, scans
and recordings. Search works on content already read, with other files available
by name as they enter the index. Check progress in the tab or status-bar menu.
Reading waits while you type and can be paused while you work.

## Commands and shortcuts

| Command in Obsidian's command palette | What it does |
| --- | --- |
| **Dowse: Open the search tab** | Opens the full search tab, or first-run setup. |
| **Dowse: Search the vault** | Opens Quick search; opens setup first if Dowse is off. |
| **Dowse: Show what's like this note** | Opens the related-files sidebar for the current note/file. |
| **Dowse: Pause or resume reading** | Pauses/resumes background indexing while Dowse is on. |

Assign shortcuts in **Settings → Hotkeys**. These work inside Obsidian; the plugin
does not install a system-wide hotkey.

## Search and open results

Describe a topic, an idea expressed differently, a diagram, something said in a
recording, or an object in an image. Queries can use a different language from the
content. Retrieval can miss relevant files or return loosely related candidates.

Dowse returns existing files and matching places inside them. It does not generate
an answer or a transcript. A result opens a note at its line, a PDF at its page,
an image in the image viewer, or audio/video near a matching passage/frame. Canvas
cards are selected when the current Canvas view exposes its selection API.
Excalidraw notes open in the drawing editor when that plugin is enabled.

**Matches** are separated from **less likely** results. If nothing clearly
matches, the interface says **Nothing clearly matches · closest shown**. Raw
scores stay hidden. Quick search, List, the gallery and Explore share this distinction.

In the search field, use **↑/↓** to select results, **Enter** to open and **Escape**
to clear a query. **Ctrl-click** (Windows/Linux) or **Cmd-click** (macOS) opens a
result in another tab. Quick search also supports Obsidian's suggestion navigation.

## Choose a view

### Quick search

Run **Dowse: Search the vault** for a compact search while writing. It starts with
up to 20 recent files and shows a short result list. The full collection lives in
the search tab.

### List

The list shows titles, file types, locations and matching text where available.
Without a query, it includes all active indexed files. Large lists render only
rows near the viewport to keep browsing responsive.

### Fisheye gallery

Use the wall icon to browse a visual collection. Clear matches gather in front;
stronger matches are larger, while other files become less prominent. When
nothing clearly matches, results are labelled as closest candidates instead.

Scroll to zoom, drag to move, click a file to select it and double-click to open.
With the gallery focused, **+**, **−** and **0** zoom in, zoom out and reset.
You can also drag a selected file into a note to insert a link.

### Explore

Choose **By content** for automatic groups of files with similar content, or
**By folder** for each file's immediate parent folder. Nested folders remain
distinct. Files directly in the vault appear under **Vault root files**. The
choice is remembered. Folder grouping includes files found only by name and does
not need the model to make its groups.

Scroll to zoom, drag to move and click a group sign to move to that group.
Double-click a file to open it. Search results have a numbered list and rank
markers; **↑/↓** steps through them. **+**, **−** and **0** work when Explore is
focused. Drag a selected file into a note to link it.

Explore shows representative files for large collections, up to about 1,200 on
the floor, with full group counts. Use List to browse every indexed file. Folder,
type and date filters hide files outside those filters from the floor.

## Filters

- **Type:** choose Notes, PDFs, Canvases, Images, Recordings or Videos.
- **Folders:** select multiple folders already inside your vault. A parent includes
  descendants; **Vault root files** includes only files directly in the vault.
- **Date:** choose an inclusive range. Photos use their recorded capture date when
  available; other files use their modification date.

Dowse can infer date and file-type filters from a query. Every active filter
appears as a removable chip; inferred filters are labelled. Removing an inferred
chip stops applying that constraint until you edit the query again.

Filters narrow a search. To exclude content persistently, use the controls below.

## Choose what gets searched

Right-click a file or folder in Obsidian's file explorer and choose
**Dowse: stop searching**. To include it again, choose **Dowse: search again**.

Exclusions apply across search, recent files, Explore and related files. They
follow moves and renames. Turning a parent folder back on preserves explicit
child exclusions. An item inside an excluded parent stays excluded until that
parent is enabled.

Exclusions retain the stored index so items can be enabled again without a full
reread. To clear indexed content, use the index controls in settings. Deleting a
file through Obsidian also removes it from Dowse; exclusion itself does not delete it.

## Matching moments in audio and video

Audio/video results offer **Matching moments** in Quick search and List. Select a
result in the gallery or Explore to see its moment buttons. Click a button to
open the native player there.

Audio ranges are approximate passages, not word-aligned transcripts. The GPU
reads overlapping 8-second passages; the processor uses 12-second passages.
Several relevant places can be returned from one file.

Video timestamps can identify sampled frames, normally every 3 seconds. Longer
videos use wider spacing to cap work at 1,200 GPU samples or 400 processor samples.
Short events between samples can be missed. Files read with older audio windows
or coarse video sampling are reread once after the relevant reader upgrade.

## Related files and links

Open a note and run **Dowse: Show what's like this note**. The sidebar compares it
with indexed files, including other file types. **Not linked yet** hides files
already linked to or from the current note. Click **Link** to insert a reference
at the cursor, or at the note's end when it is not being edited.

Opening search results does not edit source files. Inserting a link is the explicit
action that changes the current note.

## Settings and background reading

Under **Settings → Dowse**, you can:

- Pause reading or pause automatically on battery. A manual pause lasts until you
  resume it or Obsidian starts again.
- Set **Run the model on** to **Automatic (GPU preferred)** or **Processor**.
  Automatic falls back if GPU startup or inference fails.
- Enable **Read images** or **Read recordings and videos' sound** later. Files
  waiting for those parts are read when enabled.
- See the vault index and model's storage usage once measured.
- Use **Read everything again** to clear the index and rebuild it.
- Turn Dowse off while keeping or deleting its index.
- Remove the cached search model after turning Dowse off for this vault.

This version uses a pinned **EmbeddingGemma 2 fp16** build. The device dropdown
changes where it runs; it does not choose another model or provider.

On Windows, a separate graphics preference may be offered when another GPU is
available. It changes Windows' GPU preference for Obsidian and takes effect after
restarting Obsidian.

The model sleeps after ten idle minutes and wakes for reading/searching. Changing
device/media options while indexing is supported. Background updates retain the
selected result and manual Explore navigation; changing a query invalidates older
responses. Updated files refresh their own previews.

## Formats and limits

| Kind | Recognized extensions |
| --- | --- |
| Notes | `.md`, including `.excalidraw.md` |
| PDFs | `.pdf` |
| Canvas | `.canvas` |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.avif` |
| Audio | `.mp3`, `.m4a`, `.wav`, `.ogg`, `.flac`, `.oga`, `.opus`, `.3gp` |
| Video | `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`, `.mkv` |

A recognized extension does not guarantee its codec can be decoded by the
installed Obsidian runtime. Unsupported types, including standalone `.excalidraw`
JSON, are not indexed.

**Audio:** source files must be at most **32 MiB** and **20 minutes**. Decoded
audio over **128 MiB** is rejected. Metadata is checked before decoding oversize
files; native decoding can still allocate temporary memory. Split long lectures
or meetings into smaller files for content search. Oversize/unreadable recordings
remain searchable by filename; a video's frames can still be read when its audio
is too large.

**PDFs:** up to 5,000 pages are read. Pages are saved as reading progresses so
interrupted reads can resume. Text pages do not require image reading; scanned
or mostly visual pages need it. Enabling images later adds their visual content
without embedding the existing PDF text again.

**Excalidraw:** readable text/descriptions in `.excalidraw.md` are searched;
hidden compressed scene data is excluded. With the Excalidraw community plugin
enabled, the gallery and Explore preview the whole drawing, refresh after changes
and open it in its editor. Export a PNG to index its visual content too.

## Storage and privacy

Selected model data downloads once from Hugging Face and is cached in Obsidian's
profile, shared across vaults. Runtime JavaScript, workers and ONNX WebAssembly
are bundled in the plugin. Once selected parts are cached, inference works offline.
Vault content is processed locally.

Each vault's index is a separate local IndexedDB database outside the vault. It
contains embeddings, passage text and metadata, and is not synced with your notes.
Plugin settings are stored with the vault. Original files stay in place.

Clearing an index does not delete notes. Excluding a file hides it but retains its
index. Removing the plugin does not automatically remove cached model data. To
remove it, turn Dowse off and use **Remove the search model from this computer**
in its settings before uninstalling. Other enabled vaults download it again if needed.

Upgrading from an unpinned model build rebuilds the index once to avoid mixing
embeddings from different revisions. If another tool clears Obsidian's browser
storage/cache, the index/model must be read/downloaded again.

## Troubleshooting

| What you see | What to try |
| --- | --- |
| Dowse asks for an installer update | Reinstall using the current [Obsidian desktop installer](https://obsidian.md/download). The in-app updater may leave Electron unchanged. Your vault files are kept. |
| A model download/startup fails | Read the message in the Dowse tab, use **Try again**, check access to Hugging Face, or choose **Processor**. |
| A picture/recording is found only by name | Enable the relevant reading option, wait for reading to finish, and check the media limits above. |
| Files seem missing | Check exclusions, active filters, reading progress and supported types. Use List for every file; Explore represents large collections. |
| A result is only loosely related | Check the confidence label, narrow the query or add filters. Closest candidates do not guarantee the requested content exists. |
| The player opens near the right words | Ranges are approximate; replay or skip within the passage. |
| A GPU/driver is unreliable | Choose **Processor** under **Settings → Dowse → Run the model on**. |
| An error persists | Open Obsidian's developer console and include the Dowse error, reproduction steps and app/installer versions in a report. Avoid sharing private vault content. |
