"""Exports Dowse's testbed index and its eval queries for the plugin's search to be checked against Dowse's own: the
same index (files, segments' words and fp16 vectors, the probe bank), the same query vectors, and Dowse's answers.

Run with Dowse's own environment (its model and Experiments/testbed-fresh.sqlite, made by its ranking experiment):

    cd <dowse> && scripts/win.sh python <this script> evals/testbed.json evals/hard.json <out dir>

Writes <out dir>/index.json, segments.f16 (the vectors, in segment order), queries.json, and explore.json (the
vocabulary's vectors and Dowse's Explore map of the index).
"""

import base64
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

from dowse import explore, paths, probes, runtime, searcher as searching
from dowse.embedder import Embedder, Prompts
from dowse.searcher import Searcher, strong_count
from dowse.store import Store

specs = [json.loads(Path(f).read_text(encoding="utf-8")) for f in sys.argv[1:-1]]
out = Path(sys.argv[-1])
out.mkdir(parents=True, exist_ok=True)
base = os.path.expanduser(specs[0]["base"])
now = next((datetime.strptime(s["now"], "%Y-%m-%d %H:%M").timestamp() for s in specs if "now" in s), None)
queries = [q for spec in specs for q in spec["queries"]]

store = Store(paths.home() / "Experiments" / "testbed-fresh.sqlite")
db = store.db
relative = lambda p: os.path.relpath(p, base).replace("\\", "/")   # noqa: E731
files = [{"id": i, "path": relative(p), "kind": k, "mtime": m * 1000, "info": json.loads(info or "{}")}
         for i, p, k, m, info in db.execute("SELECT id, path, kind, mtime, info FROM files WHERE active = 1")]
segments, vectors = [], []
for sid, fid, kind, modality, loc, end, vec, name, body, original in db.execute(
        "SELECT s.id, s.file, s.kind, s.modality, s.loc, s.loc_end, s.vec, f.name, f.body, f.original "
        "FROM segments s LEFT JOIN fts f ON f.rowid = s.id ORDER BY s.id"):
    segments.append({"id": sid, "file": fid, "kind": kind, "modality": modality, "loc": loc, "locEnd": end,
                     "name": name or "", "body": original or body or "", "vector": len(vectors) if vec else None})
    if vec:
        vectors.append(vec)
(out / "segments.f16").write_bytes(b"".join(vectors))
bank = probes.load(store)
(out / "index.json").write_text(json.dumps({
    "files": files, "segments": segments,
    "probes": base64.b64encode(bank.astype(np.float32).tobytes()).decode() if bank is not None else None,
}, ensure_ascii=False))

asked = getattr(searching, "for_meaning")
with runtime.Server(runtime.load(), text_only=True) as server, Embedder(server.url, parallel=1) as embedder:
    query_vectors = {q["q"]: embedder.query(asked(q["q"], now=now)) for q in queries}
    words = embedder.texts([Prompts.query(w) for w in explore.WORDS]).astype(np.float32)
centred = words - words.mean(axis=0)
snapshot = explore._build_snapshot(store, centred / np.linalg.norm(centred, axis=1, keepdims=True))
(out / "explore.json").write_text(json.dumps({
    "words": base64.b64encode(words.tobytes()).decode(),
    "aisles": snapshot["aisles"], "membership": {a: [relative(p) for p in m] for a, m in snapshot["membership"].items()},
}, ensure_ascii=False))
dowse = Searcher(store)
answers = []
for query in queries:
    vector = query_vectors[query["q"]]
    hits = dowse.search(query["q"], vector, limit=10, now=now)
    answers.append({"q": query["q"], "expect": query["expect"], "tag": query.get("tag", ""),
                    "vector": base64.b64encode(np.asarray(vector, np.float32).tobytes()).decode(),
                    "dowse": [{"path": relative(h.path), "z": h.z, "score": h.score, "clear": h.clear,
                               "loc": h.loc, "locEnd": h.loc_end} for h in hits],
                    "strong": strong_count(hits)})
(out / "queries.json").write_text(json.dumps({"now": now * 1000 if now else None, "queries": answers},
                                             ensure_ascii=False))
print(f"{len(files)} files, {len(segments)} segments ({len(vectors)} vectors), {len(answers)} queries -> {out}")
