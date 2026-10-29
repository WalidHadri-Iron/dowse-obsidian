"""Writes tests/fixtures/explore.json: Dowse's own Explore map of a small synthetic index (files of three modalities
around five themes, a few files like none of them), for the plugin's port to be checked against.

K-means is seeded differently here (numpy's generator), so the groups are given: Dowse's `kmeans` is replaced by the
themes as labels, and the rest (cohesion, names, layout, spirals) is Dowse's. The plugin's own k-means is checked to
find the themes by itself.

Run with Dowse's own environment:

    cd <dowse> && scripts/win.sh python <this script> <out.json>
"""

import base64
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

from dowse import explore
from dowse.store import Store

DIM = 768
VOCABULARY = "beach sea snow mountains city street music piano invoice bank tax recipe cake coffee dog cat " \
             "meeting notes code error".split()
rng = np.random.default_rng(3)


def unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


themes = unit(rng.normal(size=(5, DIM)))
gap = {"text": unit(rng.normal(size=DIM)) * 0.6, "image": unit(rng.normal(size=DIM)) * 0.6,
       "audio": unit(rng.normal(size=DIM)) * 0.6}   # the modality gap: each kind sits in its own region
files, labels = [], []
for t in range(5):
    for n in range(14 + t):   # 83 files in all: Dowse makes 5 groups of that many
        modalities = ["text", "text"] if n % 3 == 0 else ["image"] if n % 3 == 1 else ["audio"]
        vectors = [unit(themes[t] + gap[m] + rng.normal(size=DIM) * 0.035) for m in modalities]
        kind = {"text": "note", "image": "image", "audio": "audio"}[modalities[0]]
        files.append({"path": f"theme {t}/file {n}.{kind}", "kind": kind, "segments": list(zip(modalities, vectors))})
        labels.append(t)
for n in range(3):   # like no theme: k-means puts them somewhere, cohesion takes them out
    v = unit(rng.normal(size=DIM) + gap["text"])
    files.append({"path": f"odd/file {n}.note", "kind": "note", "segments": [("text", v)]})
    labels.append(n % 5)
order = rng.permutation(len(files))   # stored in a shuffled order: nothing may depend on the themes being together
files = [files[i] for i in order]
labels = np.array(labels)[order]
words = unit(themes[np.arange(len(VOCABULARY)) % 5] * 0.4 + rng.normal(size=(len(VOCABULARY), DIM)) * 0.05
             ).astype(np.float32)

out = Path(sys.argv[1])
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
    store = Store(Path(folder) / "explore.sqlite")
    with store.transaction():
        for f in files:
            fid = store.db.execute("INSERT INTO files(path, kind, size, mtime, state) VALUES (?, ?, 1, 1, 'done')",
                                   (f["path"], f["kind"])).lastrowid
            for modality, vector in f["segments"]:
                store.db.execute("INSERT INTO segments(file, kind, modality, vec) VALUES (?, 'x', ?, ?)",
                                 (fid, modality, vector.astype("<f2").tobytes()))
    ids, vectors = explore._file_vectors(store)
    explore.WORDS = VOCABULARY
    explore.kmeans = lambda points, k: (labels, None)
    snapshot = explore._build_snapshot(store, unit(words - words.mean(axis=0)))   # (as `word_vectors` centres them)
    store.close()

f16 = lambda v: base64.b64encode(np.asarray(v, "<f2").tobytes()).decode()   # noqa: E731
f32 = lambda v: base64.b64encode(np.asarray(v, "<f4").tobytes()).decode()   # noqa: E731
out.write_text(json.dumps({
    "files": [{"path": f["path"], "kind": f["kind"],
               "vectors": [{"modality": m, "vector": f16(v)} for m, v in f["segments"]]} for f in files],
    "labels": labels.tolist(), "k": 5, "vocabulary": VOCABULARY, "words": f32(words),
    "fileVectors": [row[:8].tolist() for row in vectors],
    "map": {"aisles": snapshot["aisles"], "pieces": snapshot["pieces"], "membership": snapshot["membership"]},
}, indent=None), encoding="utf-8")
print(len(files), "files;", [(a["label"], a["count"]) for a in snapshot["aisles"]])
