# 0.1.0 release candidate

- Excalidraw notes display the actual drawing in Wall and Explore when the Excalidraw plugin is enabled. The whole
  diagram fits the preview, and a result opens in the drawing editor. Hidden compressed scene data is not searched.
- Audio uses shorter overlapping passages, with clickable matching moments in every results view. Native players
  wait for metadata and seek completion before cueing the selected moment. Timings are approximate passage ranges.
- Search remains usable during reading. Old responses cannot replace a newer query, clearing returns to the
  collection, and Explore preserves manual navigation and existing previews through background refreshes.
- File edits, deletions, moves and exclusions update safely during indexing. Shutdown cancels outstanding work;
  completed saves cannot overwrite newer revisions or recreate removed files. Larger vaults reuse pending work
  rather than reading the full file table before every file.
- The collection list includes every active indexed file with windowed rendering. Folder/date/type filters are
  removable, multiple folders can be selected, and closest candidates are distinguished from clear matches.
- The model revision is pinned. Settings offers processor mode; automatic mode falls back from a failed GPU.
  Older unpinned indexes rebuild once. Original vault files are not modified by indexing.

Install the `dowse/` folder from the ZIP into a test vault's `.obsidian/plugins/` directory and enable Dowse under
Community plugins. To update, disable the plugin and replace `main.js`, `styles.css` and `manifest.json` together.
The first-run screen asks before downloading the model and reading the vault. See README for runtime requirements
and browser media limits. This is a desktop release candidate, not an Obsidian community-directory release.

Validation and remaining limits are recorded in `measurements/release-validation-2026-11-03.md`. Native CI results
and install artifacts are available in the repository's Actions tab. The broader media comparison uses controlled
clean speech and known video shots; noisy recordings and manual Apple GPU testing remain separate checks.
