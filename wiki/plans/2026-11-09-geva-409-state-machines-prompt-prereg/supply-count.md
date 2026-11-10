# Free supply count for the implicit state machines prompt eval (GEVA-409, 2026-11-08)

Counts only. No model calls. Read from the published Hugging Face parquet files of each dataset on 2026-11-08 (downloads, then local DuckDB queries with supply-count.py, attached beside this file). "Bug-like" is a keyword screen of the issue text (bug, error, crash, wrong, fails and similar, and not a feature request); "state keywords" is a keyword screen of the issue text and fix for state words (stale, stuck, already closed, after cancel, retry, lifecycle, pending, race and similar). Both are rough; the real labels come from two cross-family judges at freeze.

## Where post-cutoff, runnable bug fixes exist today

| Source (published container per task) | Newest task | Tasks created on or after 2026-07-01 |
|---|---|---|
| SWE-bench-Live MultiLang (C, C++, C#, Go, Java, JS, Rust, TS) | 2026-07-31 | 231 |
| SWE-bench-Live (Python) full, test, verified, lite | 2025-09-02 | 0 |
| SWE-rebench leaderboard (Python; the pool our earlier runs pinned) | 2026-05-12 | 0 |
| SWE-rebench V2 | 2025-10-31 | 0 |
| SWE-rebench V2 PRs (no containers) | 2025-07-23 | 0 |

Opus 5.5's published training cutoff is June 2026; GPT-6.1 Sol's reported cutoff is 2026-04-30; particle-1 was released 2026-10-17 or later with no published cutoff.

## Post-cutoff set: July 2026, SWE-bench-Live MultiLang

- 231 tasks in 57 repositories; 219 have a container, at least one fail-to-pass test and at least one pass-to-pass test.
- 162 are bug-like; 157 of those change 1 to 6 files; they span 49 repositories.
- With at most 3 tasks per repository: 98.
- Languages of the 157: Rust 47, Java 43, C 27, C++ 15, C# 14, JS 11; no Python, TypeScript or Go.
- State keywords: 34 of 157 (22%).
- Concentration: the top repositories hold 30, 20 and 17 tasks.

## Pooled set: March to July 2026 (MultiLang plus the Python leaderboard)

- 764 tasks in 304 repositories; 731 usable as above; 504 bug-like; 484 of those change 1 to 6 files (229 repositories).
- With at most 3 tasks per repository: 350.
- By month (bug-like, 1 to 6 files): March 112, April 145, May 23, June 47, July 157.
- By language: Rust 82, C++ 80, Java 73, Python 64, C# 60, C 47, Go 43, JS 22, TS 13.
- State keywords: 84 of 484 (17%).

## What this means for the plan

- Post-cutoff only (July 2026) gives about 100 units after a repository cap, and fewer after the defect filter: a paired MDD near 13 to 15 points.
- The pooled March to July set gives about 350 after the cap, enough for a 40-unit pilot and a confirmatory set sized for a 10-point MDD, with July (post-cutoff for both frontier models) reported as its own stratum.
- No public post-cutoff supply is in TypeScript or Python, the languages of two of the three repositories the exploration ran on. Mining and containerizing our own post-cutoff fixes would close that gap at a cost in weeks.
- State-shaped bugs are a minority (about 17 to 22% by keywords), so the stratum split needs a stratified draw to see both what the lens finds and what it misses.
