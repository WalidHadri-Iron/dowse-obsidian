"""Generate accuracy-test variants, preserving independent ground-truth timestamps.

Requires ffmpeg/ffprobe. These are controlled degradations, not real noisy-recording samples.
Example: python3 scripts/degrade-media-corpus.py --source .cache/release-validation/media-corpus \
  --out .cache/extended-tests/noise12 --mode noise --snr 12
"""
import argparse
import array
import copy
import json
import math
import shutil
import subprocess
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--source", type=Path, required=True)
p.add_argument("--out", type=Path, required=True)
p.add_argument("--mode", choices=["noise", "tempo"], required=True)
p.add_argument("--snr", type=float, default=12)
p.add_argument("--audio-rate", type=float, default=1.25)
p.add_argument("--video-rate", type=float, default=1.5)
args = p.parse_args()
assert args.source.resolve() != args.out.resolve(), "Never overwrite the original corpus"
assert .5 <= args.audio_rate <= 2 and .5 <= args.video_rate <= 2
truth = json.loads((args.source / "truth.json").read_text())
output = copy.deepcopy(truth)
output["conditions"] = {"mode": args.mode, "source": "clean synthetic speech and known shots"}
if args.mode == "noise":
    output["conditions"].update(snr_db=args.snr, noise="seeded uniform white noise; global RMS before mix/codec")
else:
    output["conditions"].update(audio_rate=args.audio_rate, video_rate=args.video_rate)
paths = {}
for i, file in enumerate(output["files"]):
    old = file["path"]
    source = args.source / "vault" / old
    # Keep neutral filenames: neither the condition nor the query is searchable as a filename.
    name = f"Audio/case-{i:02}.ogg" if file["kind"] == "audio" else f"Video/case-{i:02}.mp4"
    paths[old] = name
    target = args.out / "vault" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source)]
    if args.mode == "noise" and file["kind"] == "audio":
        pcm = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(source), "-ac", "1", "-ar", "24000", "-f", "f32le", "-"])
        samples = array.array("f", pcm)
        rms = math.sqrt(sum(x*x for x in samples) / len(samples))
        amplitude = rms * 10**(-args.snr / 20) * math.sqrt(3)
        duration = len(samples) / 24000
        cmd += ["-f", "lavfi", "-i", f"anoisesrc=color=white:seed={9234+i}:amplitude={amplitude}:sample_rate=24000:duration={duration}",
                "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:normalize=0,volume=0.5[out]", "-map", "[out]",
                "-c:a", "libvorbis", "-q:a", "4"]
        file["clean_rms"] = rms
    elif args.mode == "noise":
        shutil.copyfile(source, target)
        file["path"] = name
        continue
    elif file["kind"] == "audio":
        cmd += ["-af", f"atempo={args.audio_rate}", "-c:a", "libvorbis", "-q:a", "4"]
    else:
        cmd += ["-vf", f"setpts=PTS/{args.video_rate}", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "12"]
    subprocess.run([*cmd, str(target)], check=True)
    file["path"] = name
    if args.mode == "tempo":
        rate = args.audio_rate if file["kind"] == "audio" else args.video_rate
        for section in file.get("sections", []):
            section["start"] /= rate
            section["end"] /= rate
for query in output["queries"]:
    for expect in query["expect"]:
        expect["path"] = paths[expect["path"]]
        if args.mode == "tempo":
            rate = args.audio_rate if query["kind"] == "audio" else args.video_rate
            expect["start"] /= rate
            expect["end"] /= rate
(args.out / "truth.json").write_text(json.dumps(output, indent=2) + "\n")
print(f"Wrote {len(output['files'])} files, {len(output['queries'])} queries: {args.out}")
