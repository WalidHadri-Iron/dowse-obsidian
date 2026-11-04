"""Extract focused README GIFs from the approved demo MP4.

Usage: python3 scripts/make-readme-gifs.py /path/to/dowse-obsidian-demo-smooth-fisheye.mp4
Requires ffmpeg on PATH. Timing/size settings live in docs/media/clips.json.
"""
import json
from pathlib import Path
import subprocess
import sys

repo = Path(__file__).resolve().parent.parent
if len(sys.argv) != 2:
    raise SystemExit(__doc__)
source = Path(sys.argv[1]).expanduser().resolve()
if not source.is_file():
    raise SystemExit(f"Video not found: {source}")
folder = repo / "docs" / "media"
plan = json.loads((folder / "clips.json").read_text())
for clip in plan["clips"]:
    out = folder / (clip["name"] + ".gif")
    filters = (f"fps={plan['fps']},scale={plan['width']}:-1:flags=lanczos,split[x][y];"
               "[x]palettegen=max_colors=256:stats_mode=diff[p];"
               "[y][p]paletteuse=dither=none:diff_mode=rectangle")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(clip["start"]),
                    "-t", str(clip["end"] - clip["start"]), "-i", str(source),
                    "-vf", filters, "-loop", "0", str(out)], check=True)
    print(f"{out.relative_to(repo)}: {out.stat().st_size / 1024 / 1024:.2f} MiB", flush=True)
