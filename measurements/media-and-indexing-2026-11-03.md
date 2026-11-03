# Media moments and indexing stability

Verified with the production bundle in Windows Obsidian, using the separate **Dowse Plugin Test** vault.

## Media

- Audio previously used 30-second passages. Overlapping 8-second GPU passages (12 seconds on the processor) now
  locate shorter sections. Reader versions automatically migrate existing media indexes.
- The baking demo now returns **0:28–0:36**, with **0:00–0:08** as an additional relevant passage. These are
  approximate passage ranges, not aligned transcript words. Video frame search returns **0:09** in Clip 031.
- Preserved additional moments through the view boundary and added buttons in Quick search, List, Wall and Explore.
- Native player seeks wait for metadata and seek completion; cancelled navigation cannot seek a later file.
- Actual clicks cued audio at 28 seconds and video at 9 seconds. Playing continued at 28.77 and 9.81 seconds,
  respectively, instead of resetting to zero. Quick search keyboard selection cued 28 seconds; a secondary moment
  button cued zero. All four result presentations displayed the matching moments.

## Indexing and interaction

The temporary workload contained four approximately 50-second audio files, two images and eight long notes
(40 sections each). It was removed after testing; no original demo files were deleted. The window was visible
throughout measurement. Initial camera animation and thumbnail uploads finished before recording responsiveness.

- Six searches entered using keyboard events settled **162–254 ms after typing**, including the 150 ms debounce.
  Indexing entered both reading and waiting states; it yields while the user types.
- Maximum measured input-handler time: **4.3 ms**. Maximum 20 ms interval gap: **53.6 ms**. No tasks above the
  browser's 50 ms long-task reporting threshold were recorded in the final run. This is a local workload check,
  not a guarantee for arbitrary vault sizes, hardware or GPU drivers.
- A real response was deliberately held, then released after clearing the input: the collection stayed visible,
  the field stayed empty and busy state cleared. Pending results were disabled while a different query ran.
- Folder filtering hid nonmatching files during indexing. No renderer errors or crashes were observed.
- Explore retained manual camera distance **25.0086** through a background map refresh. All **78** preexisting
  cases were reused, retaining their textures. Edited preview versions reload individually; late images from an
  older version cannot overwrite the current preview.
- Earlier runs, before preview reuse and after less warm-up, recorded tasks up to 130 ms; the conditions differ,
  so the final run alone does not isolate the contribution of each change.

## Checks

72 automated tests passed, TypeScript and Svelte checks reported zero errors or warnings, production build passed.
Native records are under `.cache/demo-expansion/media-verification.json` and `indexing-verification.json`.
