"""Keyless parquet to JSON lines for the state machines family's source pin (source.ts).

Usage: python3 parquet.py <in.parquet> <out.jsonl>
Run under uv with the pinned pyarrow (source.ts PYARROW). Writes one JSON object per row with every column as published,
lists as lists, timestamps as ISO strings.
"""
import json, sys
import pyarrow.parquet as pq

src, dst = sys.argv[1], sys.argv[2]
t = pq.read_table(src)
with open(dst, "x", encoding="utf-8") as out:
    for row in t.to_pylist():
        out.write(json.dumps(row, default=str, ensure_ascii=False) + "\n")
