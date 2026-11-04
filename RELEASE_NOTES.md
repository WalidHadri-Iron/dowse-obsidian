# Dowse 0.1.3

Search an Obsidian vault by meaning across notes, PDFs, images, recordings, videos
and Canvas cards, on your computer. Install it from **Settings → Community plugins →
Browse → Dowse**.

## Fixed

- **Obsidian stays responsive while pictures are made.** The gallery asks for a
  picture of every file at once; they're now made two at a time, the ones you're
  looking at first. After the gallery's first search in a 790-file vault, a note
  opened meanwhile showed in 1.6 s instead of 15 s, and the matching PDF page's
  picture appeared in 3 s instead of 15.
- **The time left is right from the start.** The first file read after starting
  carried the model's start-up time, so early estimates were several times too
  long (an 8-minute read once said "about 1 h 9 min left").
- **Link keeps your note intact.** In a note you just opened, the sidebar's Link
  put the link ahead of the first heading. It now goes at the end when the cursor
  hasn't been placed, on its own line at the start of a line, and spaced from the
  words beside it otherwise.
- **Explore's signs never repeat a word** ("Night · night").

## Release

- The ONNX runtime's unused Node.js branches (file system, paths, worker threads)
  are no longer in `main.js`.
- Releases are built by GitHub Actions from the tagged commit, with build
  provenance attestations for `main.js`, `manifest.json` and `styles.css`, and
  contain only those three files.

## Limits

Desktop only. The model downloads once (text about 542 MB; images and audio are
optional, about 336 MB and 587 MB). Audio content search accepts recordings up to
20 minutes and 32 MiB. `main.js` is about 7 MB, so Obsidian Sync's Standard plan
won't sync it: install Dowse on each computer from Browse.
