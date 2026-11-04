# Obsidian community submission

Dowse is a desktop-only local search plugin. Its directory listing is submitted
from the owner's Obsidian account at <https://community.obsidian.md>.

## Release contract

- Repository: `WalidHadri-Iron/dowse-obsidian` (public).
- Plugin ID: `dowse`; name: `Dowse`; author: `Walid Hadri`.
- Minimum app version: **1.15.0**, matching the native test runtime. A recent
  installer is also needed for the embedded inference runtime.
- GitHub release tag must exactly match `manifest.json`'s `version` (`0.1.3`),
  without a `v` prefix. A version such as `0.1.0` is valid; 1.0 is not required.
- The release holds only **main.js**, **manifest.json** and **styles.css**: the
  directory recommends no other files (Obsidian downloads only these three).
- The release is built by the `Release` workflow from the tagged commit, with build
  provenance attestations for those three files (the directory recommends them).
- `main.js` embeds Dowse's license and bundled dependency notices because the
  community installer downloads only those three runtime files.
- Keep `manifest.json`, `package.json`, the lockfile and `versions.json` in sync.
  Preserve previously published release assets and tags.

## Before publishing a release

Complete the main CI and extended native workflows on the revision to release, then
push its version tag: the `Release` workflow runs lint, types, tests and the build,
attests the files and drafts the release. Review the draft, publish it, then use
**Check for new releases** on the directory listing.
`python3 scripts/package.py` still builds a ZIP for testing by hand; it isn't
attached to releases. The latter includes the settings enable/disable and processor-choice
regression check in addition to mixed readers, views and Excalidraw coverage.

The official Obsidian ESLint configuration checks production and development
TypeScript, Svelte scripts/templates, the manifest, package metadata and license.
Shared modules schedule and cancel through their owning window or worker; Node
unit tests supply a minimal worker timer host. Worker bootstrap uses `self`.
No rules exclude these modules or suppress their timer/platform checks.
The pinned ONNX runtime's `powerPreference` property currently produces one
reported deprecation warning; it still controls the runtime's GPU selection.
The build takes the ONNX runtime loader's unused Node.js branches out of `main.js`
(no `fs`, `path`, `url`, `util`, `os` or `worker_threads`) and fails if one remains.
The directory's behaviour scan still reports `child_process`: the Windows graphics
preference (opt-in, disclosed in the README) runs `reg` through it.
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
