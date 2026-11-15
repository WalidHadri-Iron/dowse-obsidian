# Dowse 0.1.4

Search an Obsidian vault by meaning across notes, PDFs, images, recordings, videos
and Canvas cards, on your computer. Install it from **Settings → Community plugins →
Browse → Dowse**.

## Fixed

- **Obsidian no longer hangs at launch on a large generated note.** Notes with long
  space-padded table rows (Dataview exports, for example) were read in time with
  the square of each row's length: one 28 MB note held Obsidian for over 13 minutes
  before it could draw. It now reads in a fraction of a second. (#1)
- **Searching no longer hangs on an excerpt with a run of `·` separators.** Each
  extra dot doubled the time to show the result. (#2)
- **Long runs of blank lines or long `%% … %%` comments read quickly.** A note with
  40,000 of them took 3.6 s to read; it now takes about 30 ms.

Thanks to @ericziko for reporting #1 and #2 with precise reproductions, and for the
fixes in #3.

Nothing needs to be read again: your index stays as it is.

## Limits

Desktop only. The model downloads once (text about 542 MB; images and audio are
optional, about 336 MB and 587 MB). Audio content search accepts recordings up to
20 minutes and 32 MiB. `main.js` is about 7 MB, so Obsidian Sync's Standard plan
won't sync it: install Dowse on each computer from Browse.
