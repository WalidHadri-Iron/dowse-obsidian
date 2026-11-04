# Obsidian community submission

Dowse is a desktop-only local search plugin. Its directory listing is submitted
from the owner's Obsidian account at <https://community.obsidian.md>.

## Release contract

- Repository: `WalidHadri-Iron/dowse-obsidian` (public).
- Plugin ID: `dowse`; name: `Dowse`; author: `Walid Hadri`.
- Minimum app version: **1.15.0**, matching the native test runtime. A recent
  installer is also needed for the embedded inference runtime.
- GitHub release tag must exactly match `manifest.json`'s `version` (`0.1.1`),
  without a `v` prefix. A version such as `0.1.0` is valid; 1.0 is not required.
- Attach **main.js**, **manifest.json**, and **styles.css** directly to that release.
  The ZIP, checksums, notices and validation report can also be attached.
- `main.js` embeds Dowse's license and bundled dependency notices because the
  community installer downloads only those three runtime files.
- Keep `manifest.json`, `package.json`, the lockfile and `versions.json` in sync.
  Preserve previously published release assets and tags.

## Before publishing a release

Run `npm ci`, `npm run lint`, `npm run check`, `npm test`, `npm run build`, then
`python3 scripts/package.py`. Check that the release identifies the committed
source revision. Complete the main CI and extended native workflows on that
revision. The latter includes the settings enable/disable and processor-choice
regression check in addition to mixed readers, views and Excalidraw coverage.

The official Obsidian ESLint configuration checks production TypeScript, Svelte
scripts/templates, the manifest, package metadata and license. Shared modules
that also run in workers/Node deliberately retain environment-neutral timers;
the worker bootstrap deliberately uses `globalThis`, since it has no `window`.
The pinned ONNX runtime's `powerPreference` property currently produces one
reported deprecation warning; it still controls the runtime's GPU selection.
No rule suppresses that warning. The lint dependencies are development-only;
`npm audit --omit=dev` checks the distributed dependency tree separately.

## Submit the directory entry

1. Sign in with an Obsidian account and connect the GitHub account that owns the
   repository.
2. Choose **Plugins → New plugin**, enter
   `https://github.com/WalidHadri-Iron/dowse-obsidian`, and select the owner.
3. Review the developer policies and the maintenance commitment, then submit.
4. On the draft listing, select **Check for new releases** after the matching
   GitHub release is published. Inspect the Manifest, Releases, Source code and
   Build verification results. Fix errors and publish a new incremented release
   when needed; use **Review branch** to inspect a candidate before release.
5. Review the description, then select **Publish**. Publishing a listing does
   not bypass review errors; installation remains unavailable until resolved.

The repository URL and GitHub release are public. The authenticated directory
submission and its review status are separate: publishing a release does not
submit or approve the listing automatically.

## Suggested listing description

Find notes, PDFs, images, recordings and videos by meaning, using a local model.

Payment: **Free**. Desktop only. No service account or API key required. Hugging
Face supplies the optional model downloads; vault content and queries stay local.
The Windows graphics preference accesses the per-user registry only when changed
explicitly, as disclosed in the README.

Official references: [submission](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin),
[account setup](https://docs.obsidian.md/community-directory/set-up-and-claim),
[requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins),
[review FAQ](https://docs.obsidian.md/community-directory/faq).
