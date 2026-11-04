"""Package an existing production build. Run npm run build first, then python3 scripts/package.py.

The ZIP contains a dowse/ directory ready to place inside a vault's .obsidian/plugins/ directory.
Uses only Python's standard library; fixed ZIP metadata makes identical inputs reproducible.
"""
import hashlib
import json
import re
from urllib.parse import urlsplit
import subprocess
import zipfile
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
manifest = json.loads((repo / "manifest.json").read_text())
package = json.loads((repo / "package.json").read_text())
versions = json.loads((repo / "versions.json").read_text())
version = manifest["version"]
assert version == package["version"], "manifest and package versions differ"
assert versions[version] == manifest["minAppVersion"], "versions.json is out of sync"
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
files = {name: (repo / name).read_bytes() for name in ("main.js", "styles.css", "manifest.json", "README.md", "LICENSE")}
# A packaged README is read outside the checkout: keep its documentation and demo links usable.
def online_link(match):
    label, target = match.groups()
    if target.startswith(("#", "/", "licenses/")) or target in files or urlsplit(target).scheme:
        return match.group(0)
    host = "https://raw.githubusercontent.com" if label.startswith("!") else "https://github.com"
    route = "" if label.startswith("!") else "/blob"
    return f"{label}({host}/WalidHadri-Iron/dowse-obsidian{route}/{commit}/{target})"
files["THIRD_PARTY_NOTICES.md"] = (repo / "THIRD_PARTY_NOTICES.md").read_bytes()
for notice in sorted((repo / "licenses").glob("*")):
    if notice.is_file(): files["licenses/" + notice.name] = notice.read_bytes()
for name in ("README.md", "THIRD_PARTY_NOTICES.md"):
    files[name] = re.sub(r"(!?\[[^\]]*\])\(([^)]+)\)", online_link, files[name].decode()).encode()
assert files["main.js"] and files["styles.css"], "production build is missing"
output = repo / "build"
output.mkdir(exist_ok=True)
install = output / "dowse"
install.mkdir(exist_ok=True)
archive = output / f"dowse-obsidian-{version}.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for name, data in files.items():
        info = zipfile.ZipInfo("dowse/" + name, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        bundle.writestr(info, data, compresslevel=9)
        (install / name).parent.mkdir(parents=True, exist_ok=True)
        (install / name).write_bytes(data)
checksums = {"dowse/" + name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
checksums[archive.name] = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / "SHA256SUMS").write_text("".join(f"{digest}  {name}\n" for name, digest in checksums.items()))
(output / "release.json").write_text(json.dumps({
    "version": version,
    "commit": commit,
    "checksums": checksums,
}, indent=2) + "\n")
print(archive)
