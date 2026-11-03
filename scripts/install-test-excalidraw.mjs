// Install pinned upstream CODE only into the test cache, never a user's vault or settings.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const output = resolve(process.argv[2] ?? ".cache/test-excalidraw");
const hashes = { "main.js": "75b073229f43a81745537832ddf54f7ba62c4b1654d2e69011e1c96e86cdb149",
  "manifest.json": "65ff25a29d920e10a90722d2f5886a2ab1b83233cae6424caa750ecfaacad42f",
  "styles.css": "c743d64af1d517ce9c4bf0562ecd5c151c21c4d5431dd995b3f07f9ccc71c67c" };
await mkdir(output, { recursive: true });
for (const [name, hash] of Object.entries(hashes)) {
  const response = await fetch(`https://github.com/zsviczian/obsidian-excalidraw-plugin/releases/download/2.29.1/${name}`);
  if (!response.ok) throw new Error(`Excalidraw fixture download: ${response.status} ${name}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error(`Pinned asset digest failed: ${name}`);
  await writeFile(join(output, name), bytes);
}
console.log(`Verified Excalidraw 2.29.1 test code: ${output}`);
