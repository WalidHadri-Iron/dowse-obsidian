# The search, against Dowse's

`scripts/eval-search.ts` on Dowse's testbed index (`scripts/export-dowse-index.py`: Dowse's fresh read of its testbed,
65 files, 812 vectors; its 160 eval queries, `evals/testbed.json` + `evals/hard.json`), 2026-10-28.

| Query vectors | Dowse R@1 / R@5 / MRR / strong / false alarms | Plugin | Same first | Same top 10 | Same "found" |
|---|---|---|---|---|---|
| Dowse's (llama.cpp Q8) | 0.934 / 0.993 / 0.961 / 1.4 / 1 of 8 | 0.934 / 0.993 / 0.961 / 1.4 / 1 of 8 | 160/160 | 160/160 | 160/160 |
| The plugin's (fp16, its prompts and dates) | — | 0.934 / 0.993 / 0.961 / 1.4 / 1 of 8 | 160/160 | 150/160 | 159/160 |

On the same index and vectors the two give the same answers (z within 3.5e-5); with the plugin's own model build only
some lower places move. A search takes ~3 ms here (Node, 812 vectors). Dowse's dates (84 cases) and statistics are
checked the same way (`tests/fixtures`).
